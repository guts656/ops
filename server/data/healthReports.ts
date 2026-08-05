import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { createNotification } from '../services/notificationService'
import { sendMonitorNotifications } from '../services/outboundNotificationService'
import { shanghaiTime } from '../utils/time'

const SHANGHAI_TZ = 'Asia/Shanghai'
const REPORT_DIR = join(process.cwd(), 'storage', 'health-reports')

type HealthLevel = 'excellent' | 'good' | 'warning' | 'critical'
type Severity = 'success' | 'info' | 'warning' | 'error'

type HealthReportRow = NonNullable<Awaited<ReturnType<typeof prisma.healthReport.findFirst>>>

interface HealthCause {
  key: string
  title: string
  severity: Extract<Severity, 'warning' | 'error'>
  evidence: string[]
  relatedType?: string
  relatedId?: string
}

interface ReportSection {
  key: string
  title: string
  severity: Severity
  summary: string
  bullets: string[]
  metrics?: Array<{ label: string; value: string | number; severity?: Severity }>
}

interface OptimizationSuggestion {
  key: string
  title: string
  priority: 'high' | 'medium' | 'low'
  category: string
  rationale: string
  actions: string[]
}

function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

function avg(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function healthLevel(score: number): HealthLevel {
  if (score >= 90) return 'excellent'
  if (score >= 75) return 'good'
  if (score >= 60) return 'warning'
  return 'critical'
}

function levelLabel(level: HealthLevel) {
  return ({ excellent: '优秀', good: '良好', warning: '需关注', critical: '高风险' } as const)[level]
}

function severityByHealth(level: HealthLevel): Severity {
  return level === 'critical' ? 'error' : level === 'warning' ? 'warning' : level === 'good' ? 'info' : 'success'
}

function dateText(date: Date) {
  return date.toLocaleDateString('zh-CN', { timeZone: SHANGHAI_TZ })
}

function shanghaiParts(date: Date) {
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: SHANGHAI_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date)
  const [datePart, timePart] = text.replaceAll('/', '-').split(' ')
  return { datePart, timePart }
}

function shanghaiDateToUtc(datePart: string, timePart = '00:00:00') {
  return new Date(`${datePart}T${timePart}+08:00`)
}

function weekRangeFromDate(date = new Date()) {
  const { datePart } = shanghaiParts(date)
  const localMidnight = shanghaiDateToUtc(datePart)
  const localDay = Number(new Intl.DateTimeFormat('en-US', { timeZone: SHANGHAI_TZ, weekday: 'short' }).format(localMidnight) ? localMidnight.toLocaleDateString('en-US', { timeZone: SHANGHAI_TZ, weekday: 'short' }) : 0)
  void localDay
  const day = Number(new Intl.DateTimeFormat('en-US', { timeZone: SHANGHAI_TZ, weekday: 'short' }).format(date).replace('Mon', '1').replace('Tue', '2').replace('Wed', '3').replace('Thu', '4').replace('Fri', '5').replace('Sat', '6').replace('Sun', '7'))
  const start = new Date(localMidnight)
  start.setUTCDate(start.getUTCDate() - (Number.isNaN(day) ? 0 : day - 1))
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 7)
  return { periodStart: start, periodEnd: end }
}

function previousWeekRange(now = new Date()) {
  const current = weekRangeFromDate(now)
  const periodStart = new Date(current.periodStart)
  periodStart.setUTCDate(periodStart.getUTCDate() - 7)
  const periodEnd = new Date(current.periodStart)
  return { periodStart, periodEnd }
}

function weekRangeFromInput(weekStart?: Date) {
  if (!weekStart) return previousWeekRange()
  const { periodStart } = weekRangeFromDate(weekStart)
  const periodEnd = new Date(periodStart)
  periodEnd.setUTCDate(periodEnd.getUTCDate() + 7)
  return { periodStart, periodEnd }
}

function topEntries<T extends Record<string, unknown>>(items: T[], key: keyof T, countKey = '_count', limit = 5) {
  return items
    .map((item) => ({ name: String(item[key] ?? '未指定'), count: Number((item as Record<string, unknown>)[countKey] ?? 0) }))
    .sort((left, right) => right.count - left.count)
    .slice(0, limit)
}

function serviceStatus(statuses: string[], errorCount: number) {
  if (statuses.some((status) => ['failed', 'error', '异常', 'exited', 'dead', 'stopped', 'inactive', 'not_running', 'missing', 'removed', 'unknown'].includes(status.toLowerCase())) || errorCount > 0) return '异常'
  if (statuses.some((status) => ['degraded', 'warn', 'warning', '警告', 'restarting', 'activating', 'paused'].includes(status.toLowerCase()))) return '警告'
  return '健康'
}

function jsonArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : []
}

function jsonObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function reportFileName(reportId: string) {
  return `${reportId}.html`
}

function escapeHtml(value: unknown) {
  return String(value ?? '').replace(/[&<>"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[char] || char))
}

function renderReportHtml(report: ReturnType<typeof toReport>) {
  const meta = healthLevel(report.healthScore)
  const color = meta === 'critical' ? '#dc2626' : meta === 'warning' ? '#d97706' : meta === 'good' ? '#2563eb' : '#16a34a'
  const causes = report.causes.map((cause) => `<li><strong>${escapeHtml(cause.title)}</strong><ul>${cause.evidence.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></li>`).join('')
  const sections = report.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2><p>${escapeHtml(section.summary)}</p><ul>${section.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul></section>`).join('')
  const suggestions = report.suggestions.map((item) => `<li><strong>${escapeHtml(item.title)}</strong><p>${escapeHtml(item.rationale)}</p><ul>${item.actions.map((action) => `<li>${escapeHtml(action)}</li>`).join('')}</ul></li>`).join('')
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(report.title)}</title>
  <style>
    body { margin: 0; background: #f5f7fb; color: #172033; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .page { max-width: 960px; margin: 0 auto; padding: 40px 24px; }
    .hero { background: linear-gradient(135deg, #0f172a, #1d4ed8); color: white; border-radius: 24px; padding: 32px; box-shadow: 0 18px 50px rgba(15,23,42,.18); }
    h1 { margin: 0 0 12px; font-size: 30px; }
    h2 { color: #0f172a; margin-top: 0; }
    .score { display: inline-flex; align-items: baseline; gap: 8px; background: white; color: ${color}; border-radius: 18px; padding: 10px 18px; font-size: 34px; font-weight: 800; margin-top: 18px; }
    .score small { font-size: 14px; color: #64748b; }
    .card, section { background: white; border-radius: 18px; padding: 24px; margin-top: 20px; box-shadow: 0 10px 30px rgba(15,23,42,.08); }
    li { margin: 8px 0; line-height: 1.7; }
    p { line-height: 1.8; }
    .muted { color: #64748b; }
  </style>
</head>
<body>
  <div class="page">
    <div class="hero">
      <h1>${escapeHtml(report.title)}</h1>
      <p>${escapeHtml(report.summary)}</p>
      <div class="score">${report.healthScore}<small>/ 100 · ${escapeHtml(levelLabel(report.healthLevel))}</small></div>
      <p class="muted">周期：${escapeHtml(dateText(new Date(report.periodStart)))} 至 ${escapeHtml(dateText(new Date(report.periodEnd)))} ｜ 生成：${escapeHtml(shanghaiTime(new Date(report.generatedAt)))}</p>
    </div>
    <div class="card"><h2>健康度低的原因</h2><ul>${causes || '<li>本周未发现明显风险原因。</li>'}</ul></div>
    ${sections}
    <div class="card"><h2>后续优化建议</h2><ul>${suggestions || '<li>继续保持现有监控和巡检节奏。</li>'}</ul></div>
  </div>
</body>
</html>`
}

async function persistReportFile(report: ReturnType<typeof toReport>) {
  await mkdir(REPORT_DIR, { recursive: true })
  const fileName = reportFileName(report.id)
  await writeFile(join(REPORT_DIR, fileName), renderReportHtml(report), 'utf8')
  return { fileName, filePath: `storage/health-reports/${fileName}` }
}

function toReport(row: HealthReportRow) {
  return {
    id: row.id,
    type: row.type,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    title: row.title,
    status: row.status,
    healthScore: row.healthScore,
    healthLevel: row.healthLevel as HealthLevel,
    summary: row.summary,
    causes: jsonArray<HealthCause>(row.causes),
    alertSummary: jsonObject(row.alertSummary),
    sections: jsonArray<ReportSection>(row.sections),
    suggestions: jsonArray<OptimizationSuggestion>(row.suggestions),
    sourceSnapshot: jsonObject(row.sourceSnapshot),
    generatedBy: row.generatedBy,
    generatedAt: row.generatedAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

async function collectInputs(periodStart: Date, periodEnd: Date) {
  const [
    hosts,
    resourcePoints,
    alerts,
    activeAlerts,
    alertsByLevel,
    alertsByStatus,
    alertsBySource,
    alertsByService,
    errorLogsByService,
    warnLogCount,
    logMonitorAlerts,
    services,
    containers,
    serviceEvents,
    selfHealingRules,
    selfHealingExecutions,
    batchJobs,
  ] = await Promise.all([
    prisma.host.findMany({ select: { id: true, ip: true, hostname: true, status: true, cpu: true, memory: true, disk: true, os: true } }),
    prisma.hostResourcePoint.findMany({ where: { createdAt: { gte: periodStart, lt: periodEnd } }, select: { hostId: true, cpu: true, memory: true, disk: true, createdAt: true } }),
    prisma.alert.findMany({ where: { createdAt: { gte: periodStart, lt: periodEnd }, isSuppressed: false }, orderBy: { createdAt: 'desc' }, take: 100 }),
    prisma.alert.count({ where: { status: { not: '已解决' }, isSuppressed: false } }),
    prisma.alert.groupBy({ by: ['level'], where: { createdAt: { gte: periodStart, lt: periodEnd }, isSuppressed: false }, _count: { _all: true } }),
    prisma.alert.groupBy({ by: ['status'], where: { createdAt: { gte: periodStart, lt: periodEnd }, isSuppressed: false }, _count: { _all: true } }),
    prisma.alert.groupBy({ by: ['source'], where: { createdAt: { gte: periodStart, lt: periodEnd }, isSuppressed: false }, _count: { _all: true } }),
    prisma.alert.groupBy({ by: ['service'], where: { createdAt: { gte: periodStart, lt: periodEnd }, isSuppressed: false }, _count: { _all: true } }),
    prisma.appLog.groupBy({ by: ['service'], where: { level: 'ERROR', timestamp: { gte: periodStart, lt: periodEnd } }, _count: { _all: true } }),
    prisma.appLog.count({ where: { level: 'WARN', timestamp: { gte: periodStart, lt: periodEnd } } }),
    prisma.logMonitorAlert.findMany({ where: { createdAt: { gte: periodStart, lt: periodEnd } }, orderBy: { createdAt: 'desc' }, take: 50, include: { rule: true } }),
    prisma.hostService.findMany({ where: { host: { os: { not: 'Linux' } }, NOT: { metadata: { path: ['hiddenStoppedBaseline'], equals: true } } }, select: { name: true, status: true, hostId: true, lastReportedAt: true } }),
    prisma.hostContainer.findMany({ where: { isCurrent: true }, select: { name: true, state: true, hostId: true, lastReportedAt: true } }),
    prisma.serviceEvent.findMany({ where: { occurredAt: { gte: periodStart, lt: periodEnd } }, orderBy: { occurredAt: 'desc' }, take: 50 }),
    prisma.selfHealingRule.findMany({ select: { id: true, name: true, enabled: true, successRate: true, triggerCount: true } }),
    prisma.selfHealingExecution.findMany({ where: { createdAt: { gte: periodStart, lt: periodEnd } }, orderBy: { createdAt: 'desc' }, take: 50 }),
    prisma.batchJob.findMany({ where: { startedAt: { gte: periodStart, lt: periodEnd } }, include: { targets: true }, orderBy: { startedAt: 'desc' }, take: 50 }),
  ])

  const onlineHosts = hosts.filter((host) => host.status === '在线').length
  const hostOnlineRate = hosts.length ? (onlineHosts / hosts.length) * 100 : 100
  const cpus = resourcePoints.length ? resourcePoints.map((point) => point.cpu) : hosts.map((host) => host.cpu)
  const memories = resourcePoints.length ? resourcePoints.map((point) => point.memory) : hosts.map((host) => host.memory)
  const disks = resourcePoints.length ? resourcePoints.map((point) => point.disk) : hosts.map((host) => host.disk)
  const avgCpu = avg(cpus)
  const avgMemory = avg(memories)
  const avgDisk = avg(disks)
  const maxCpu = Math.max(...cpus, 0)
  const maxMemory = Math.max(...memories, 0)
  const maxDisk = Math.max(...disks, 0)
  const resourceScore = clampScore(100 - Math.max(avgCpu, avgMemory, avgDisk))

  const errorCountByService = Object.fromEntries(errorLogsByService.map((row) => [row.service, row._count._all]))
  const serviceRows = [
    ...services.map((service) => ({ name: service.name, status: service.status })),
    ...containers.map((container) => ({ name: container.name, status: container.state })),
  ]
  const reportedServiceCount = serviceRows.length
  const abnormalServiceCount = serviceRows.filter((service) => serviceStatus([service.status], errorCountByService[service.name] ?? 0) === '异常').length
  const warningServiceCount = serviceRows.filter((service) => serviceStatus([service.status], errorCountByService[service.name] ?? 0) === '警告').length
  const serviceHealthRate = reportedServiceCount ? ((reportedServiceCount - abnormalServiceCount - warningServiceCount * 0.5) / reportedServiceCount) * 100 : 100

  const weeklyAlertCount = alerts.length
  const highAlertCount = alerts.filter((alert) => ['紧急', '严重'].includes(alert.level)).length
  const alertScore = clampScore(100 - activeAlerts * 8 - highAlertCount * 4)
  const healthScore = clampScore(hostOnlineRate * 0.3 + serviceHealthRate * 0.25 + resourceScore * 0.25 + alertScore * 0.2)
  const errorLogCount = errorLogsByService.reduce((sum, row) => sum + row._count._all, 0)

  return {
    periodStart,
    periodEnd,
    hosts,
    onlineHosts,
    hostOnlineRate,
    avgCpu,
    avgMemory,
    avgDisk,
    maxCpu,
    maxMemory,
    maxDisk,
    resourceScore,
    reportedServiceCount,
    abnormalServiceCount,
    warningServiceCount,
    serviceHealthRate,
    alerts,
    activeAlerts,
    weeklyAlertCount,
    highAlertCount,
    alertsByLevel,
    alertsByStatus,
    alertsBySource,
    alertsByService,
    alertScore,
    errorLogsByService,
    errorLogCount,
    warnLogCount,
    logMonitorAlerts,
    serviceEvents,
    selfHealingRules,
    selfHealingExecutions,
    batchJobs,
    healthScore,
  }
}

type WeeklyInputs = Awaited<ReturnType<typeof collectInputs>>

function buildCauses(input: WeeklyInputs, score: number): HealthCause[] {
  const causes: HealthCause[] = []
  if (input.highAlertCount > 0 || input.activeAlerts > 0) {
    causes.push({ key: 'active-alerts', title: '存在未解决高等级或活跃告警', severity: input.highAlertCount ? 'error' : 'warning', evidence: [`本周高等级告警 ${input.highAlertCount} 条`, `当前未解决告警 ${input.activeAlerts} 条`] })
  }
  if (input.maxCpu >= 85 || input.maxMemory >= 85 || input.maxDisk >= 85 || Math.max(input.avgCpu, input.avgMemory, input.avgDisk) >= 75) {
    causes.push({ key: 'resource-pressure', title: '资源水位偏高', severity: Math.max(input.maxCpu, input.maxMemory, input.maxDisk) >= 90 ? 'error' : 'warning', evidence: [`平均 CPU ${input.avgCpu}% / 内存 ${input.avgMemory}% / 磁盘 ${input.avgDisk}%`, `峰值 CPU ${input.maxCpu}% / 内存 ${input.maxMemory}% / 磁盘 ${input.maxDisk}%`] })
  }
  if (input.hostOnlineRate < 95) {
    causes.push({ key: 'host-availability', title: '主机在线率不足', severity: input.hostOnlineRate < 80 ? 'error' : 'warning', evidence: [`在线主机 ${input.onlineHosts}/${input.hosts.length}`, `主机在线率 ${percent(input.hostOnlineRate)}`] })
  }
  if (input.abnormalServiceCount || input.warningServiceCount) {
    causes.push({ key: 'service-health', title: '服务或容器实例状态异常', severity: input.abnormalServiceCount ? 'error' : 'warning', evidence: [`异常实例 ${input.abnormalServiceCount} 个`, `警告实例 ${input.warningServiceCount} 个`] })
  }
  if (input.errorLogCount > 0) {
    const top = topEntries(input.errorLogsByService.map((row) => ({ service: row.service, _count: row._count._all })), 'service', '_count', 3).map((item) => `${item.name} ${item.count} 条`).join('；')
    causes.push({ key: 'error-logs', title: 'ERROR 日志集中出现', severity: input.errorLogCount >= 50 ? 'error' : 'warning', evidence: [`本周 ERROR 日志 ${input.errorLogCount} 条`, top ? `Top 服务：${top}` : '暂无服务分布'] })
  }
  const failedHealing = input.selfHealingExecutions.filter((item) => item.status !== 'success' && item.status !== '成功').length
  if (failedHealing) causes.push({ key: 'self-healing-failed', title: '自愈策略存在失败记录', severity: 'warning', evidence: [`本周自愈执行失败/非成功 ${failedHealing} 次`] })
  const failedBatch = input.batchJobs.filter((job) => job.status === 'failed' || job.status === 'partial').length
  if (failedBatch) causes.push({ key: 'batch-failed', title: '批处理任务存在失败记录', severity: 'warning', evidence: [`本周失败或部分成功批处理 ${failedBatch} 个`] })
  if (!causes.length && score >= 75) causes.push({ key: 'stable', title: '本周系统整体运行稳定', severity: 'warning', evidence: ['未发现明显拉低健康度的单一风险项，建议继续保持监控。'] })
  return causes
}

function buildSuggestions(input: WeeklyInputs, causes: HealthCause[]): OptimizationSuggestion[] {
  const suggestions: OptimizationSuggestion[] = []
  const has = (key: string) => causes.some((cause) => cause.key === key)
  if (has('active-alerts')) suggestions.push({ key: 'alert-runbook', title: '完善高频告警处理预案', priority: 'high', category: 'alert', rationale: '活跃或高等级告警会直接拉低系统健康度。', actions: ['梳理 Top 告警服务的处理 SOP', '为重复告警配置降噪或自动处理规则', '对长期未解决告警设置负责人和截止时间'] })
  if (has('resource-pressure')) suggestions.push({ key: 'capacity-plan', title: '开展资源容量治理', priority: 'high', category: 'resource', rationale: '资源水位偏高会提高故障和性能抖动风险。', actions: ['分析高峰时段 CPU/内存/磁盘趋势', '对高水位主机做扩容或服务迁移', '补充主机资源监控阈值和告警策略'] })
  if (has('error-logs')) suggestions.push({ key: 'error-log-review', title: '治理 ERROR 日志集中服务', priority: 'medium', category: 'log', rationale: 'ERROR 日志集中通常对应服务异常、依赖失败或发布缺陷。', actions: ['查看 ERROR 日志 Top 服务的样例日志', '补充专项日志监控规则', '关联最近发布、配置变更和依赖状态'] })
  if (has('service-health')) suggestions.push({ key: 'service-baseline', title: '修复异常服务和容器状态', priority: 'high', category: 'service', rationale: '服务或容器异常会影响业务可用性。', actions: ['定位异常实例所在主机', '检查服务重启/退出原因', '完善服务状态恢复和自愈策略'] })
  if (has('self-healing-failed')) suggestions.push({ key: 'self-healing-review', title: '复盘自愈失败记录', priority: 'medium', category: 'selfHealing', rationale: '自愈失败说明规则动作或前置条件可能需要调整。', actions: ['查看失败自愈执行日志', '补充动作幂等和回滚逻辑', '先以安全模式验证再开启自动执行'] })
  if (has('batch-failed')) suggestions.push({ key: 'batch-guardrail', title: '加强批处理执行前后校验', priority: 'medium', category: 'batch', rationale: '批处理失败可能导致配置不一致或任务半成功。', actions: ['复盘失败主机和 stderr 输出', '补充 MD5/退出码/幂等检查', '对高风险批处理增加灰度和回滚步骤'] })
  if (!suggestions.length) suggestions.push({ key: 'keep-baseline', title: '保持当前监控基线并继续沉淀自动化', priority: 'low', category: 'alert', rationale: '本周整体风险较低，适合继续完善平台能力。', actions: ['沉淀常见告警处理模板', '补充关键服务 SLO 指标', '定期复盘周报趋势变化'] })
  return suggestions
}

function buildSections(input: WeeklyInputs, causes: HealthCause[], suggestions: OptimizationSuggestion[]): ReportSection[] {
  const level = healthLevel(input.healthScore)
  const topAlertServices = topEntries(input.alertsByService.map((row) => ({ service: row.service, _count: row._count._all })), 'service')
  const topErrorServices = topEntries(input.errorLogsByService.map((row) => ({ service: row.service, _count: row._count._all })), 'service')
  return [
    {
      key: 'health',
      title: '系统健康度',
      severity: severityByHealth(level),
      summary: `本周系统健康度 ${input.healthScore} 分，等级为${levelLabel(level)}。`,
      bullets: [`主机在线率 ${percent(input.hostOnlineRate)}，在线 ${input.onlineHosts}/${input.hosts.length}`, `服务/容器健康率 ${percent(input.serviceHealthRate)}`, `资源评分 ${input.resourceScore}，告警评分 ${input.alertScore}`],
      metrics: [{ label: '健康度', value: input.healthScore }, { label: '主机在线率', value: percent(input.hostOnlineRate) }, { label: '未解决告警', value: input.activeAlerts }],
    },
    {
      key: 'alerts',
      title: '告警总结',
      severity: input.highAlertCount ? 'error' : input.weeklyAlertCount ? 'warning' : 'success',
      summary: `本周产生告警 ${input.weeklyAlertCount} 条，其中高等级告警 ${input.highAlertCount} 条。`,
      bullets: [`当前未解决告警 ${input.activeAlerts} 条`, topAlertServices.length ? `Top 告警服务：${topAlertServices.map((item) => `${item.name} ${item.count} 条`).join('；')}` : '本周无明显告警服务集中项'],
    },
    {
      key: 'logs',
      title: '日志与 ERROR 风险',
      severity: input.errorLogCount ? 'warning' : 'success',
      summary: `本周 ERROR 日志 ${input.errorLogCount} 条，WARN 日志 ${input.warnLogCount} 条。`,
      bullets: [topErrorServices.length ? `ERROR Top 服务：${topErrorServices.map((item) => `${item.name} ${item.count} 条`).join('；')}` : '本周未发现 ERROR 日志集中服务', `日志监控触发 ${input.logMonitorAlerts.length} 次`],
    },
    {
      key: 'operations',
      title: '自愈与批处理',
      severity: suggestions.some((item) => ['selfHealing', 'batch'].includes(item.category) && item.priority !== 'low') ? 'warning' : 'info',
      summary: '辅助运维能力运行情况汇总。',
      bullets: [`自愈规则 ${input.selfHealingRules.length} 条，本周执行 ${input.selfHealingExecutions.length} 次`, `批处理任务 ${input.batchJobs.length} 个`],
    },
    {
      key: 'suggestions',
      title: '后续优化建议',
      severity: 'info',
      summary: `基于本周风险项生成 ${suggestions.length} 条优化建议。`,
      bullets: suggestions.map((item) => `${item.title}：${item.actions[0]}`),
    },
  ]
}

function buildReport(input: WeeklyInputs) {
  const level = healthLevel(input.healthScore)
  const causes = buildCauses(input, input.healthScore)
  const suggestions = buildSuggestions(input, causes)
  const sections = buildSections(input, causes, suggestions)
  const alertSummary = {
    total: input.weeklyAlertCount,
    active: input.activeAlerts,
    high: input.highAlertCount,
    byLevel: Object.fromEntries(input.alertsByLevel.map((row) => [row.level, row._count._all])),
    byStatus: Object.fromEntries(input.alertsByStatus.map((row) => [row.status, row._count._all])),
    bySource: Object.fromEntries(input.alertsBySource.map((row) => [row.source || '未指定', row._count._all])),
    topServices: topEntries(input.alertsByService.map((row) => ({ service: row.service, _count: row._count._all })), 'service'),
  }
  const sourceSnapshot = {
    hosts: { total: input.hosts.length, online: input.onlineHosts, onlineRate: input.hostOnlineRate },
    resources: { avgCpu: input.avgCpu, avgMemory: input.avgMemory, avgDisk: input.avgDisk, maxCpu: input.maxCpu, maxMemory: input.maxMemory, maxDisk: input.maxDisk },
    services: { total: input.reportedServiceCount, abnormal: input.abnormalServiceCount, warning: input.warningServiceCount },
    alerts: alertSummary,
    logs: { error: input.errorLogCount, warn: input.warnLogCount, topErrorServices: topEntries(input.errorLogsByService.map((row) => ({ service: row.service, _count: row._count._all })), 'service') },
    operations: { selfHealingExecutions: input.selfHealingExecutions.length, batchJobs: input.batchJobs.length },
  }
  const title = `${dateText(input.periodStart)} 至 ${dateText(new Date(input.periodEnd.getTime() - 1))} 系统健康周报`
  const summary = `本周系统健康度 ${input.healthScore} 分（${levelLabel(level)}）。主要关注点：${causes.slice(0, 3).map((cause) => cause.title).join('、') || '整体稳定'}。`
  return { title, level, summary, causes, alertSummary, sections, suggestions, sourceSnapshot }
}

export async function listHealthReports(filters: { page?: number; pageSize?: number; type?: string } = {}) {
  const page = Math.max(1, Math.floor(filters.page ?? 1))
  const pageSize = Math.min(50, Math.max(1, Math.floor(filters.pageSize ?? 10)))
  const where = { type: filters.type ?? 'weekly' }
  const [total, rows] = await prisma.$transaction([
    prisma.healthReport.count({ where }),
    prisma.healthReport.findMany({ where, orderBy: { generatedAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ])
  return { items: rows.map(toReport), total, page, pageSize }
}

export async function getHealthReport(id: string) {
  const row = await prisma.healthReport.findUnique({ where: { id } })
  return row ? toReport(row) : undefined
}

export async function getHealthReportHtml(id: string) {
  const report = await getHealthReport(id)
  if (!report) return undefined
  const fileName = reportFileName(report.id)
  try {
    return { report, fileName, content: await readFile(join(REPORT_DIR, fileName), 'utf8') }
  } catch {
    const file = await persistReportFile(report)
    return { report, fileName: file.fileName, content: await readFile(join(REPORT_DIR, file.fileName), 'utf8') }
  }
}

export async function generateWeeklyHealthReport(input: { weekStart?: Date; generatedBy: string; force?: boolean }) {
  const { periodStart, periodEnd } = weekRangeFromInput(input.weekStart)
  const existing = await prisma.healthReport.findFirst({ where: { type: 'weekly', periodStart, periodEnd } })
  if (existing && !input.force) return toReport(existing)
  const weeklyInputs = await collectInputs(periodStart, periodEnd)
  const report = buildReport(weeklyInputs)
  const data = {
    type: 'weekly',
    periodStart,
    periodEnd,
    title: report.title,
    status: 'completed',
    healthScore: weeklyInputs.healthScore,
    healthLevel: report.level,
    summary: report.summary,
    causes: report.causes as unknown as Prisma.InputJsonValue,
    alertSummary: report.alertSummary as unknown as Prisma.InputJsonValue,
    sections: report.sections as unknown as Prisma.InputJsonValue,
    suggestions: report.suggestions as unknown as Prisma.InputJsonValue,
    sourceSnapshot: report.sourceSnapshot as unknown as Prisma.InputJsonValue,
    generatedBy: input.generatedBy,
    generatedAt: new Date(),
  }
  const row = existing
    ? await prisma.healthReport.update({ where: { id: existing.id }, data })
    : await prisma.healthReport.create({ data })
  const mapped = toReport(row)
  const file = await persistReportFile(mapped)
  const updated = await prisma.healthReport.update({
    where: { id: row.id },
    data: { sourceSnapshot: { ...mapped.sourceSnapshot, reportFile: file } as Prisma.InputJsonValue },
  })
  return toReport(updated)
}

export async function generateCurrentWeeklyHealthReport(generatedBy: string, force = false) {
  return generateWeeklyHealthReport({ generatedBy, force })
}

function configuredDuePassed(now = new Date()) {
  if (process.env.HEALTH_REPORT_SCHEDULER_ENABLED === 'false') return false
  const weekday = Number(new Intl.DateTimeFormat('en-US', { timeZone: SHANGHAI_TZ, weekday: 'short' }).format(now).replace('Mon', '1').replace('Tue', '2').replace('Wed', '3').replace('Thu', '4').replace('Fri', '5').replace('Sat', '6').replace('Sun', '7'))
  const { timePart } = shanghaiParts(now)
  const [hour, minute] = timePart.split(':').map(Number)
  const dueDay = Number(process.env.HEALTH_REPORT_WEEKLY_DAY || 1)
  const dueHour = Number(process.env.HEALTH_REPORT_WEEKLY_HOUR || 9)
  const dueMinute = Number(process.env.HEALTH_REPORT_WEEKLY_MINUTE || 10)
  if (weekday !== dueDay) return false
  return hour > dueHour || (hour === dueHour && minute >= dueMinute)
}

export async function runDueWeeklyHealthReport(now = new Date()) {
  if (!configuredDuePassed(now)) return undefined
  const { periodStart, periodEnd } = previousWeekRange(now)
  const existing = await prisma.healthReport.findFirst({ where: { type: 'weekly', periodStart, periodEnd } })
  if (existing) return toReport(existing)
  const report = await generateWeeklyHealthReport({ weekStart: periodStart, generatedBy: 'system' })
  await createNotification({
    type: 'system',
    level: report.healthLevel === 'critical' ? 'error' : report.healthLevel === 'warning' ? 'warning' : 'success',
    title: '每周系统健康报告已生成',
    content: `${report.title}，健康度 ${report.healthScore} 分（${levelLabel(report.healthLevel)}）`,
    entityType: 'healthReport',
    entityId: report.id,
    metadata: { type: report.type, periodStart: report.periodStart, periodEnd: report.periodEnd, healthScore: report.healthScore, healthLevel: report.healthLevel },
  })
  await sendMonitorNotifications({
    content: `【每周系统健康报告】${report.title}\n健康度：${report.healthScore} 分（${levelLabel(report.healthLevel)}）\n摘要：${report.summary}\n优化建议：${report.suggestions.slice(0, 3).map((item) => item.title).join('；') || '暂无'}`,
  })
  return report
}
