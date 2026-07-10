import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { isHostInMaintenance } from './hosts'
import { ingestAlert } from '../services/alertIngestionService'
import { disableGeneratedMonitorSelfHealingBinding, normalizeAndValidateMonitorSelfHealingBinding, normalizeMonitorSelfHealingBinding, syncMonitorSelfHealingBinding } from '../services/monitorSelfHealingBinding'
import { sendMonitorNotifications } from '../services/outboundNotificationService'
import type { LogMonitorAlertRecord, LogMonitorNotification, LogMonitorRule, LogMonitorRuleInput, LogMonitorTimeRange } from '../types/log'
import { startOfShanghaiTodayUtc } from './logs'
import { shanghaiTime } from '../utils/time'

type LogMonitorRuleRow = NonNullable<Awaited<ReturnType<typeof prisma.logMonitorRule.findFirst>>>
type LogMonitorAlertRow = NonNullable<Awaited<ReturnType<typeof prisma.logMonitorAlert.findFirst>>>

type EvaluateResult = {
  rule: LogMonitorRule
  matchedCount: number
  matchedKeywords: string[]
  sampleLogIds: string[]
  triggered: boolean
  skippedReason?: string
}

const weekdayMap = [7, 1, 2, 3, 4, 5, 6]

function nowText(date = new Date()) {
  return shanghaiTime(date)
}

function normalizeKeywords(values: string[] = []) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean))).slice(0, 20)
}

function normalizeTimeRanges(ranges: LogMonitorTimeRange[] | undefined) {
  return (ranges ?? [])
    .map((range) => ({ start: range.start?.trim(), end: range.end?.trim() }))
    .filter((range) => /^\d{2}:\d{2}$/.test(range.start) && /^\d{2}:\d{2}$/.test(range.end) && range.start < range.end)
    .slice(0, 8)
}

function normalizeHolidays(values: string[] | undefined) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))).slice(0, 80)
}

function notificationValue(value: unknown): LogMonitorNotification {
  const notification = value as Partial<LogMonitorNotification> | undefined
  const channels = Array.isArray(notification?.channels) ? notification.channels.filter((channel) => ['站内告警', '企业微信', '钉钉'].includes(channel)) : ['站内告警']
  return {
    channels: channels.length ? channels as LogMonitorNotification['channels'] : ['站内告警'],
    webhookUrl: notification?.webhookUrl || undefined,
    receivers: notification?.receivers || undefined,
  }
}

function bindingValue(value: unknown, fallbackCooldown: number) {
  return normalizeMonitorSelfHealingBinding(value, fallbackCooldown) as LogMonitorRule['selfHealingBinding']
}

async function normalizeSelfHealingBinding(value: unknown, fallbackCooldown: number) {
  return normalizeAndValidateMonitorSelfHealingBinding(value, fallbackCooldown) as Promise<LogMonitorRule['selfHealingBinding']>
}

function toRule(rule: LogMonitorRuleRow): LogMonitorRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    service: rule.service || undefined,
    level: rule.level as LogMonitorRule['level'] | undefined,
    hostId: rule.hostId || undefined,
    hostScope: rule.hostScope as LogMonitorRule['hostScope'],
    hostIds: rule.hostIds,
    hostGroup: rule.hostGroup || undefined,
    source: rule.source || undefined,
    keywords: rule.keywords,
    threshold: rule.threshold,
    windowMinutes: rule.windowMinutes,
    cooldownMinutes: rule.cooldownMinutes,
    alertLevel: rule.alertLevel as LogMonitorRule['alertLevel'],
    daysOfWeek: rule.daysOfWeek,
    timeRanges: Array.isArray(rule.timeRanges) ? rule.timeRanges as unknown as LogMonitorTimeRange[] : [],
    holidayMode: rule.holidayMode as LogMonitorRule['holidayMode'],
    holidays: rule.holidays,
    notification: notificationValue(rule.notification),
    selfHealingBinding: bindingValue(rule.selfHealingBinding, rule.cooldownMinutes),
    generatedSelfHealingRuleId: rule.generatedSelfHealingRuleId ?? undefined,
    generatedAlertHandlingRuleId: rule.generatedAlertHandlingRuleId ?? undefined,
    lastEvaluatedAt: rule.lastEvaluatedAt?.toISOString(),
    lastTriggeredAt: rule.lastTriggeredAt?.toISOString(),
    triggerCount: rule.triggerCount,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

function toAlertRecord(record: LogMonitorAlertRow): LogMonitorAlertRecord {
  return {
    id: record.id,
    ruleId: record.ruleId,
    alertId: record.alertId,
    matchedCount: record.matchedCount,
    windowStart: record.windowStart.toISOString(),
    windowEnd: record.windowEnd.toISOString(),
    matchedKeywords: record.matchedKeywords,
    sampleLogIds: record.sampleLogIds,
    notificationResults: record.notificationResults,
    createdAt: record.createdAt.toISOString(),
  }
}

function normalizeHostScope(input: LogMonitorRuleInput) {
  const hostIds = Array.from(new Set((input.hostIds ?? []).map((hostId) => hostId.trim()).filter(Boolean)))
  const hostScope = input.hostScope ?? (input.hostId ? 'single' : 'all')
  if (hostScope === 'single') {
    const hostId = input.hostId?.trim() || hostIds[0]
    if (!hostId) throw new Error('请选择主机')
    return { hostScope, hostId, hostIds: [hostId], hostGroup: null }
  }
  if (hostScope === 'multiple') {
    if (!hostIds.length) throw new Error('请选择至少一台主机')
    return { hostScope, hostId: null, hostIds, hostGroup: null }
  }
  if (hostScope === 'group') {
    const hostGroup = input.hostGroup?.trim()
    if (!hostGroup) throw new Error('请选择主机组')
    return { hostScope, hostId: null, hostIds: [], hostGroup }
  }
  return { hostScope: 'all' as const, hostId: null, hostIds: [], hostGroup: null }
}

function hasMatchCondition(keywords: string[], input: LogMonitorRuleInput, hostScope: ReturnType<typeof normalizeHostScope>) {
  return Boolean(keywords.length || input.level || input.service?.trim() || input.source?.trim() || hostScope.hostScope !== 'all')
}

async function ruleData(input: LogMonitorRuleInput) {
  const keywords = normalizeKeywords(input.keywords)
  const hostScope = normalizeHostScope(input)
  if (!hasMatchCondition(keywords, input, hostScope)) throw new Error('请至少填写关键字或选择日志级别/服务/来源/主机范围')
  const cooldownMinutes = Math.max(1, Math.floor(input.cooldownMinutes ?? 30))
  return {
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    enabled: input.enabled ?? true,
    service: input.service?.trim() || null,
    level: input.level || null,
    hostId: hostScope.hostId,
    hostScope: hostScope.hostScope,
    hostIds: hostScope.hostIds,
    hostGroup: hostScope.hostGroup,
    source: input.source?.trim() || null,
    keywords,
    threshold: Math.max(1, Math.floor(input.threshold)),
    windowMinutes: Math.max(1, Math.floor(input.windowMinutes)),
    cooldownMinutes,
    alertLevel: input.alertLevel ?? '警告',
    daysOfWeek: Array.from(new Set((input.daysOfWeek ?? []).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))).sort(),
    timeRanges: normalizeTimeRanges(input.timeRanges) as unknown as Prisma.InputJsonValue,
    holidayMode: input.holidayMode ?? 'ignore',
    holidays: normalizeHolidays(input.holidays),
    notification: notificationValue(input.notification) as unknown as Prisma.InputJsonValue,
    selfHealingBinding: await normalizeSelfHealingBinding(input.selfHealingBinding, cooldownMinutes) as unknown as Prisma.InputJsonValue,
  }
}

function localDateParts(date: Date) {
  const text = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
  const [datePart, timePart] = text.replaceAll('/', '-').split(' ')
  return { date: datePart, time: timePart, weekday: weekdayMap[date.getDay()] }
}

function expandDateTemplate(value: string | undefined, date = new Date()) {
  if (!value) return undefined
  const current = localDateParts(date)
  const [year, month, day] = current.date.split('-')
  return value
    .replaceAll('%Y', year)
    .replaceAll('%m', month)
    .replaceAll('%d', day)
}

function sourceWhere(source: string | undefined, date = new Date()): Prisma.AppLogWhereInput['source'] {
  const value = expandDateTemplate(source?.trim(), date)
  if (!value) return undefined
  if (value === 'file') return { notIn: ['docker', 'eventlog:Application', 'eventlog:System', 'smoke'] }
  if (value.endsWith('\\') || value.endsWith('/')) return { startsWith: value }
  if (/^[a-zA-Z]:[\\/][^*?]*$/.test(value) && !/\.(log|txt)$/i.test(value)) return { startsWith: value.endsWith('\\') ? value : `${value}\\` }
  if (value.startsWith('/') && !/\.(log|txt)$/i.test(value)) return { startsWith: value.endsWith('/') ? value : `${value}/` }
  return value
}

function isRuleActive(rule: LogMonitorRule, date = new Date()) {
  const current = localDateParts(date)
  if (rule.daysOfWeek.length && !rule.daysOfWeek.includes(current.weekday)) return false
  const holidayMatched = rule.holidays.includes(current.date)
  if (rule.holidayMode === 'include' && !holidayMatched) return false
  if (rule.holidayMode === 'exclude' && holidayMatched) return false
  if (rule.timeRanges.length && !rule.timeRanges.some((range) => current.time >= range.start && current.time <= range.end)) return false
  return true
}

function inCooldown(rule: LogMonitorRule, date = new Date()) {
  if (!rule.lastTriggeredAt) return false
  return date.getTime() - new Date(rule.lastTriggeredAt).getTime() < rule.cooldownMinutes * 60_000
}

function keywordWhere(keywords: string[]) {
  return keywords.map((keyword) => ({ message: { contains: keyword, mode: 'insensitive' as const } }))
}

async function resolveRuleHostFilter(rule: LogMonitorRule): Promise<{ hostId?: Prisma.AppLogWhereInput['hostId']; skippedReason?: string }> {
  const scope = rule.hostScope ?? (rule.hostId ? 'single' : 'all')
  if (scope === 'all') return {}
  if (scope === 'single') {
    const hostId = rule.hostId || rule.hostIds[0]
    return hostId ? { hostId } : { skippedReason: '未选择主机' }
  }
  if (scope === 'multiple') {
    const hostIds = Array.from(new Set(rule.hostIds.filter(Boolean)))
    return hostIds.length ? { hostId: { in: hostIds } } : { skippedReason: '未选择主机' }
  }
  if (!rule.hostGroup) return { skippedReason: '未选择主机组' }
  const hosts = await prisma.host.findMany({ where: { group: rule.hostGroup }, select: { id: true } })
  const hostIds = hosts.map((host) => host.id)
  return hostIds.length ? { hostId: { in: hostIds } } : { skippedReason: '主机组暂无主机' }
}

function targetText(rule: LogMonitorRule) {
  const scope = rule.hostScope ?? (rule.hostId ? 'single' : 'all')
  if (scope === 'single') return rule.hostId || rule.hostIds[0] || '单台主机'
  if (scope === 'multiple') return `多主机 ${rule.hostIds.length} 台`
  if (scope === 'group') return `主机组：${rule.hostGroup || '未指定'}`
  return '全部主机'
}

function matchConditionText(rule: LogMonitorRule, matchedKeywords: string[]) {
  if (matchedKeywords.length) return `日志关键字「${matchedKeywords.join('、')}」`
  if (rule.level) return `日志级别「${rule.level}」`
  if (rule.service) return `服务「${rule.service}」日志`
  if (rule.source) return `来源「${rule.source}」日志`
  return `${targetText(rule)}日志`
}

async function activeMaintenanceHostIds(hostIds: string[], date: Date) {
  const uniqueHostIds = Array.from(new Set(hostIds.filter(Boolean)))
  const entries = await Promise.all(uniqueHostIds.map(async (hostId) => [hostId, await isHostInMaintenance(hostId, date)] as const))
  return entries.filter(([, active]) => active).map(([hostId]) => hostId)
}

async function createAlertForRule(rule: LogMonitorRule, matchedCount: number, matchedKeywords: string[], sampleLogIds: string[], windowStart: Date, windowEnd: Date, matchedHostIds: string[] = []) {
  const service = rule.service || targetText(rule) || rule.source || '日志监控'
  const sourceHostId = matchedHostIds.length === 1 ? matchedHostIds[0] : undefined
  const samples = sampleLogIds.length ? await prisma.appLog.findMany({ where: { id: { in: sampleLogIds } }, orderBy: { timestamp: 'desc' } }) : []
  const sampleHostIds = Array.from(new Set(samples.map((log) => log.hostId).filter(Boolean) as string[]))
  const sampleHosts = sampleHostIds.length ? await prisma.host.findMany({ where: { id: { in: sampleHostIds } }, select: { id: true, ip: true, hostname: true } }) : []
  const hostById = new Map(sampleHosts.map((host) => [host.id, host]))
  const topServices = Array.from(new Set(samples.map((log) => log.service).filter(Boolean))).slice(0, 3)
  const topHosts = Array.from(new Set(samples.map((log) => {
    const host = log.hostId ? hostById.get(log.hostId) : undefined
    return host ? `${host.ip}(${host.hostname})` : log.hostId || '未知主机'
  }))).slice(0, 3)
  const topSources = Array.from(new Set(samples.map((log) => log.source || '未指定来源'))).slice(0, 3)
  const conditionText = matchConditionText(rule, matchedKeywords)
  const sampleText = samples.slice(0, 3).map((log, index) => {
    const host = log.hostId ? hostById.get(log.hostId) : undefined
    const hostText = host ? `${host.ip}(${host.hostname})` : log.hostId || '未知主机'
    const message = log.message.replace(/\s+/g, ' ').slice(0, 220)
    return `${index + 1}. 主机：${hostText}\n   服务/容器：${log.service}\n   来源：${log.source || '未指定'}\n   时间：${shanghaiTime(log.timestamp)}\n   内容：${message}`
  }).join('\n')
  const title = topServices.length === 1 ? `ERROR 日志：${topServices[0]}` : rule.name
  const content = `${conditionText}在 ${rule.windowMinutes} 分钟内出现 ${matchedCount} 次，达到阈值 ${rule.threshold} 次。\n\n定位信息：\n- 主机：${topHosts.join('、') || targetText(rule)}\n- 服务/容器：${topServices.join('、') || rule.service || '未识别'}\n- 日志来源：${topSources.join('、') || rule.source || '未识别'}\n\n样例日志：\n${sampleText || '暂无样例日志'}\n\n处理建议：请优先进入日志查询，按上述主机、服务/容器和日志来源筛选最近 ERROR 日志；若为重复问题，可为该服务配置专项日志监控或自愈规则。`
  const notificationResults = await sendMonitorNotifications({ ruleNotification: rule.notification, content: `【${rule.alertLevel}】${title}\n${content}\n服务/范围：${service}\n时间：${nowText()}` })
  const result = await ingestAlert({
    level: rule.alertLevel,
    time: nowText(),
    service,
    title,
    content,
    owner: rule.notification.receivers || '日志监控',
    source: '日志监控',
    relatedType: 'log_monitor_rule',
    relatedId: rule.id,
    outboundNotification: { channels: ['站内告警'] },
    metadata: {
      ruleId: rule.id,
      ruleName: rule.name,
      hostId: sourceHostId ?? rule.hostId,
      sourceHostId,
      hostScope: rule.hostScope,
      hostIds: rule.hostIds,
      hostGroup: rule.hostGroup,
      selfHealingTargetHostId: rule.selfHealingBinding?.targetHostId,
      selfHealingTargetServiceId: rule.selfHealingBinding?.targetServiceId,
      selfHealingTargetServiceName: rule.selfHealingBinding?.targetServiceName || rule.selfHealingBinding?.serviceName,
      targetHostId: rule.selfHealingBinding?.targetHostId,
      targetServiceId: rule.selfHealingBinding?.targetServiceId,
      targetServiceName: rule.selfHealingBinding?.targetServiceName || rule.selfHealingBinding?.serviceName,
      matchedHostIds,
      matchedCount,
      matchedKeywords,
      sampleLogIds,
      sampleHosts: topHosts,
      sampleServices: topServices,
      sampleSources: topSources,
      sampleMessages: samples.slice(0, 3).map((log) => {
        const host = log.hostId ? hostById.get(log.hostId) : undefined
        return { id: log.id, hostId: log.hostId, hostIp: host?.ip, hostname: host?.hostname, service: log.service, source: log.source, timestamp: log.timestamp.toISOString(), message: log.message.slice(0, 500) }
      }),
      windowStart: windowStart.toISOString(),
      windowEnd: windowEnd.toISOString(),
    },
  })

  await prisma.$transaction([
    ...(result.alert ? [prisma.logMonitorAlert.create({ data: { ruleId: rule.id, alertId: result.alert.id, matchedCount, windowStart, windowEnd, matchedKeywords, sampleLogIds, notificationResults } })] : []),
    prisma.logMonitorRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: windowEnd, lastEvaluatedAt: windowEnd, triggerCount: { increment: 1 } } }),
  ])
}

export async function listLogMonitorRules() {
  const rules = await prisma.logMonitorRule.findMany({ orderBy: { createdAt: 'desc' } })
  return rules.map(toRule)
}

export async function getLogMonitorRule(id: string) {
  const rule = await prisma.logMonitorRule.findUnique({ where: { id } })
  return rule ? toRule(rule) : undefined
}

function logConditionService(rule: LogMonitorRuleRow) {
  return rule.service || rule.level || rule.source || rule.name
}

async function disableGeneratedLogMonitorBinding(rule: Pick<LogMonitorRuleRow, 'generatedSelfHealingRuleId' | 'generatedAlertHandlingRuleId'>) {
  await disableGeneratedMonitorSelfHealingBinding(rule)
}

async function syncLogMonitorSelfHealingBinding(rule: LogMonitorRuleRow) {
  const ids = await syncMonitorSelfHealingBinding({
    monitorType: 'log',
    alertSource: '日志监控',
    relatedType: 'log_monitor_rule',
    ruleId: rule.id,
    ruleName: rule.name,
    enabled: rule.enabled,
    alertLevel: rule.alertLevel,
    cooldownMinutes: rule.cooldownMinutes,
    binding: rule.selfHealingBinding,
    conditionMetric: rule.level || (rule.keywords.length ? 'log_keyword' : 'log_count'),
    conditionService: logConditionService(rule),
    conditionIntervalSeconds: Math.max(10, rule.windowMinutes * 60),
    description: `由日志监控「${rule.name}」自动生成，请优先从日志监控规则维护。`,
    notificationReceivers: notificationValue(rule.notification).receivers,
    generatedSelfHealingRuleId: rule.generatedSelfHealingRuleId,
    generatedAlertHandlingRuleId: rule.generatedAlertHandlingRuleId,
  })
  if (!ids.generatedSelfHealingRuleId && !ids.generatedAlertHandlingRuleId) return rule
  return prisma.logMonitorRule.update({ where: { id: rule.id }, data: ids })
}

export async function createLogMonitorRule(input: LogMonitorRuleInput) {
  const rule = await prisma.logMonitorRule.create({ data: await ruleData(input) })
  const synced = await syncLogMonitorSelfHealingBinding(rule)
  return toRule(synced)
}

export async function updateLogMonitorRule(id: string, input: LogMonitorRuleInput) {
  const rule = await prisma.logMonitorRule.update({ where: { id }, data: await ruleData(input) })
  const synced = await syncLogMonitorSelfHealingBinding(rule)
  return toRule(synced)
}

export async function deleteLogMonitorRule(id: string) {
  const rule = await prisma.logMonitorRule.findUnique({ where: { id } })
  if (rule) await disableGeneratedLogMonitorBinding(rule)
  await prisma.logMonitorRule.delete({ where: { id } })
}

export async function ensureDefaultErrorLogMonitorRule() {
  const existing = await prisma.logMonitorRule.findUnique({ where: { id: 'builtin-error-log-alerts' } })
  if (existing) return toRule(existing)
  const rule = await prisma.logMonitorRule.create({
    data: {
      id: 'builtin-error-log-alerts',
      name: '所有 ERROR 日志告警',
      description: '平台内置规则：所有 ERROR 级别日志进入报警中心。',
      enabled: true,
      service: null,
      level: 'ERROR',
      hostId: null,
      hostScope: 'all',
      hostIds: [],
      hostGroup: null,
      source: null,
      keywords: [],
      threshold: 1,
      windowMinutes: 5,
      cooldownMinutes: 1,
      alertLevel: '严重',
      daysOfWeek: [],
      timeRanges: [],
      holidayMode: 'ignore',
      holidays: [],
      notification: notificationValue({ channels: ['站内告警'], receivers: '日志监控' }) as unknown as Prisma.InputJsonValue,
    },
  })
  return toRule(rule)
}

export async function listLogMonitorAlerts(ruleId?: string) {
  const records = await prisma.logMonitorAlert.findMany({ where: { ruleId }, orderBy: { createdAt: 'desc' }, take: 100 })
  return records.map(toAlertRecord)
}

export async function evaluateLogMonitorRule(rule: LogMonitorRule, date = new Date()): Promise<EvaluateResult> {
  if (!rule.enabled) return { rule, matchedCount: 0, matchedKeywords: [], sampleLogIds: [], triggered: false, skippedReason: '规则已停用' }
  if (!isRuleActive(rule, date)) return { rule, matchedCount: 0, matchedKeywords: [], sampleLogIds: [], triggered: false, skippedReason: '不在生效周期内' }
  if (inCooldown(rule, date)) return { rule, matchedCount: 0, matchedKeywords: [], sampleLogIds: [], triggered: false, skippedReason: '处于冷却期' }

  const lastTriggeredCursor = rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).getTime() + 1 : 0
  const windowStart = new Date(Math.max(startOfShanghaiTodayUtc(date).getTime(), date.getTime() - rule.windowMinutes * 60_000, lastTriggeredCursor))
  const where: Prisma.AppLogWhereInput = {
    timestamp: { gte: windowStart, lte: date },
  }
  if (rule.keywords.length) where.OR = keywordWhere(rule.keywords)
  const hostFilter = await resolveRuleHostFilter(rule)
  if (hostFilter.skippedReason) {
    await prisma.logMonitorRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: date } })
    return { rule, matchedCount: 0, matchedKeywords: [], sampleLogIds: [], triggered: false, skippedReason: hostFilter.skippedReason }
  }
  if (hostFilter.hostId) where.hostId = hostFilter.hostId
  if (rule.service) where.service = { equals: rule.service, mode: 'insensitive' }
  if (rule.level) where.level = rule.level
  if (rule.source) where.source = sourceWhere(rule.source, date)
  const [matchedCount, sampleLogs] = await prisma.$transaction([
    prisma.appLog.count({ where }),
    prisma.appLog.findMany({ where, orderBy: { timestamp: 'desc' }, take: 5, select: { id: true, message: true, timestamp: true, hostId: true } }),
  ])
  const matchedKeywords = rule.keywords.filter((keyword) => sampleLogs.some((log) => log.message.toLowerCase().includes(keyword.toLowerCase())))
  await prisma.logMonitorRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: date } })

  if (matchedCount < rule.threshold) {
    return { rule, matchedCount, matchedKeywords, sampleLogIds: sampleLogs.map((log) => log.id), triggered: false }
  }
  const matchedHostIds = Array.from(new Set(sampleLogs.map((log) => log.hostId).filter(Boolean) as string[]))
  const maintenanceHostIds = await activeMaintenanceHostIds(matchedHostIds.length ? matchedHostIds : rule.hostId ? [rule.hostId] : [], date)
  if (maintenanceHostIds.length && maintenanceHostIds.length === (matchedHostIds.length || (rule.hostId ? 1 : 0))) {
    return { rule, matchedCount, matchedKeywords: matchedKeywords.length ? matchedKeywords : rule.keywords, sampleLogIds: sampleLogs.map((log) => log.id), triggered: false, skippedReason: '主机维护中，已跳过告警' }
  }

  const latestMatchedAt = sampleLogs.reduce((latest, log) => log.timestamp > latest ? log.timestamp : latest, windowStart)
  await createAlertForRule(rule, matchedCount, matchedKeywords.length ? matchedKeywords : rule.keywords, sampleLogs.map((log) => log.id), windowStart, latestMatchedAt, matchedHostIds.filter((hostId) => !maintenanceHostIds.includes(hostId)))
  return { rule, matchedCount, matchedKeywords: matchedKeywords.length ? matchedKeywords : rule.keywords, sampleLogIds: sampleLogs.map((log) => log.id), triggered: true }
}

export async function evaluateLogMonitorRulesOnce() {
  const rules = await listLogMonitorRules()
  const results: EvaluateResult[] = []
  for (const rule of rules) {
    results.push(await evaluateLogMonitorRule(rule))
  }
  return results
}
