import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { ingestAlert } from '../services/alertIngestionService'
import { sendMonitorNotifications } from '../services/outboundNotificationService'
import { shanghaiTime } from '../utils/time'
import type { HostResourceMetric, HostResourceMonitorAlertRecord, HostResourceMonitorNotification, HostResourceMonitorRule, HostResourceMonitorRuleInput, LogMonitorTimeRange } from '../../src/types/hostResourceMonitor'

type RuleRow = NonNullable<Awaited<ReturnType<typeof prisma.hostResourceMonitorRule.findFirst>>>
type AlertRow = NonNullable<Awaited<ReturnType<typeof prisma.hostResourceMonitorAlert.findFirst>>>
type HostTarget = { id: string; ip: string; hostname: string; group: string; tags: string[]; cpu: number; memory: number; disk: number }
type SustainedMetricState = { matched: boolean; value: number; sampledAt: Date; windowStart?: Date; sampleCount?: number }

const weekdayMap = [7, 1, 2, 3, 4, 5, 6]
const metricLabels: Record<HostResourceMetric, string> = { cpu: 'CPU', memory: '内存', disk: '磁盘' }
const allowedMetrics = new Set<HostResourceMetric>(['cpu', 'memory', 'disk'])
const SUSTAINED_SAMPLE_GRACE_MS = 90_000

function nowText(date = new Date()) {
  return shanghaiTime(date)
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const next = Math.floor(Number(value ?? fallback))
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}

function normalizeMetrics(values: HostResourceMetric[] | undefined) {
  const metrics = Array.from(new Set((values ?? ['cpu', 'memory', 'disk']).filter((metric) => allowedMetrics.has(metric))))
  return metrics.length ? metrics : ['cpu', 'memory', 'disk']
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

function notificationValue(value: unknown): HostResourceMonitorNotification {
  const notification = value as Partial<HostResourceMonitorNotification> | undefined
  const channels = Array.isArray(notification?.channels) ? notification.channels.filter((channel) => ['站内告警', '企业微信', '钉钉'].includes(channel)) : ['站内告警']
  return {
    channels: channels.length ? channels as HostResourceMonitorNotification['channels'] : ['站内告警'],
    webhookUrl: notification?.webhookUrl || undefined,
    receivers: notification?.receivers || undefined,
  }
}

function toRule(rule: RuleRow): HostResourceMonitorRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    hostId: rule.hostId || undefined,
    hostScope: rule.hostScope as HostResourceMonitorRule['hostScope'],
    hostIds: rule.hostIds,
    hostGroup: rule.hostGroup || undefined,
    metrics: rule.metrics.filter((metric) => allowedMetrics.has(metric as HostResourceMetric)) as HostResourceMetric[],
    threshold: rule.threshold,
    durationMinutes: rule.durationMinutes ?? 1,
    cooldownMinutes: rule.cooldownMinutes,
    alertLevel: rule.alertLevel as HostResourceMonitorRule['alertLevel'],
    daysOfWeek: rule.daysOfWeek,
    timeRanges: Array.isArray(rule.timeRanges) ? rule.timeRanges as unknown as LogMonitorTimeRange[] : [],
    holidayMode: rule.holidayMode as HostResourceMonitorRule['holidayMode'],
    holidays: rule.holidays,
    notification: notificationValue(rule.notification),
    lastEvaluatedAt: rule.lastEvaluatedAt?.toISOString(),
    lastTriggeredAt: rule.lastTriggeredAt?.toISOString(),
    triggerCount: rule.triggerCount,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

function toAlertRecord(record: AlertRow): HostResourceMonitorAlertRecord {
  return {
    id: record.id,
    ruleId: record.ruleId,
    alertId: record.alertId,
    hostId: record.hostId,
    metric: record.metric as HostResourceMetric,
    value: record.value,
    threshold: record.threshold,
    sampledAt: record.sampledAt.toISOString(),
    notificationResults: record.notificationResults,
    createdAt: record.createdAt.toISOString(),
  }
}

function normalizeHostScope(input: HostResourceMonitorRuleInput) {
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

function ruleData(input: HostResourceMonitorRuleInput) {
  const hostScope = normalizeHostScope(input)
  return {
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    enabled: input.enabled ?? true,
    hostId: hostScope.hostId,
    hostScope: hostScope.hostScope,
    hostIds: hostScope.hostIds,
    hostGroup: hostScope.hostGroup,
    metrics: normalizeMetrics(input.metrics),
    threshold: clampInt(input.threshold, 80, 1, 100),
    durationMinutes: clampInt(input.durationMinutes, 1, 1, 1440),
    cooldownMinutes: clampInt(input.cooldownMinutes, 30, 1, 1440),
    alertLevel: input.alertLevel ?? '警告',
    daysOfWeek: Array.from(new Set((input.daysOfWeek ?? []).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))).sort(),
    timeRanges: normalizeTimeRanges(input.timeRanges) as unknown as Prisma.InputJsonValue,
    holidayMode: input.holidayMode ?? 'ignore',
    holidays: normalizeHolidays(input.holidays),
    notification: notificationValue(input.notification) as unknown as Prisma.InputJsonValue,
  }
}

function localDateParts(date: Date) {
  const text = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(date)
  const [datePart, timePart] = text.replaceAll('/', '-').split(' ')
  return { date: datePart, time: timePart, weekday: weekdayMap[date.getDay()] }
}

function isRuleActive(rule: HostResourceMonitorRule, date = new Date()) {
  const current = localDateParts(date)
  if (rule.daysOfWeek.length && !rule.daysOfWeek.includes(current.weekday)) return false
  const holidayMatched = rule.holidays.includes(current.date)
  if (rule.holidayMode === 'include' && !holidayMatched) return false
  if (rule.holidayMode === 'exclude' && holidayMatched) return false
  if (rule.timeRanges.length && !rule.timeRanges.some((range) => current.time >= range.start && current.time <= range.end)) return false
  return true
}

function inCooldown(rule: HostResourceMonitorRule, date = new Date()) {
  if (!rule.lastTriggeredAt) return false
  return date.getTime() - new Date(rule.lastTriggeredAt).getTime() < rule.cooldownMinutes * 60_000
}

function ruleMatchesHost(rule: HostResourceMonitorRule, host: HostTarget) {
  const scope = rule.hostScope ?? (rule.hostId ? 'single' : 'all')
  if (scope === 'all') return true
  if (scope === 'single') return host.id === (rule.hostId || rule.hostIds[0])
  if (scope === 'multiple') return rule.hostIds.includes(host.id)
  return Boolean(rule.hostGroup && host.group === rule.hostGroup)
}

function serviceText(host: HostTarget) {
  return `${host.hostname || host.ip} (${host.ip})`
}

function hostNameText(host: HostTarget) {
  return host.hostname || host.ip
}

function hostTagText(host: HostTarget) {
  const labels = (host.tags || []).filter(Boolean)
  return labels.length ? labels.join('、') : '未设置'
}

async function getSustainedMetricState(rule: HostResourceMonitorRule, host: HostTarget, metric: HostResourceMetric, date: Date): Promise<SustainedMetricState> {
  const durationMinutes = Math.max(1, rule.durationMinutes ?? 1)
  if (durationMinutes <= 1) {
    const value = host[metric]
    return { matched: value >= rule.threshold, value, sampledAt: date, sampleCount: 1 }
  }

  const windowStart = new Date(date.getTime() - durationMinutes * 60_000)
  const points = await prisma.hostResourcePoint.findMany({
    where: { hostId: host.id, sampledAt: { gte: windowStart, lte: date } },
    orderBy: { sampledAt: 'asc' },
    select: { sampledAt: true, cpu: true, memory: true, disk: true },
  })
  if (!points.length) return { matched: false, value: host[metric], sampledAt: date, windowStart, sampleCount: 0 }

  const earliest = points[0]
  const latest = points[points.length - 1]
  const latestValue = latest[metric]
  const latestFresh = date.getTime() - latest.sampledAt.getTime() <= SUSTAINED_SAMPLE_GRACE_MS
  const windowCovered = earliest.sampledAt.getTime() <= windowStart.getTime() + SUSTAINED_SAMPLE_GRACE_MS
  const allAboveThreshold = points.every((point) => point[metric] >= rule.threshold)
  return {
    matched: latestFresh && windowCovered && allAboveThreshold,
    value: latestValue,
    sampledAt: latest.sampledAt,
    windowStart,
    sampleCount: points.length,
  }
}

export async function listHostResourceMonitorRules() {
  const rules = await prisma.hostResourceMonitorRule.findMany({ orderBy: { createdAt: 'desc' } })
  return rules.map(toRule)
}

export async function getHostResourceMonitorRule(id: string) {
  const rule = await prisma.hostResourceMonitorRule.findUnique({ where: { id } })
  return rule ? toRule(rule) : undefined
}

export async function createHostResourceMonitorRule(input: HostResourceMonitorRuleInput) {
  const rule = await prisma.hostResourceMonitorRule.create({ data: ruleData(input) })
  return toRule(rule)
}

export async function updateHostResourceMonitorRule(id: string, input: HostResourceMonitorRuleInput) {
  const rule = await prisma.hostResourceMonitorRule.update({ where: { id }, data: ruleData(input) })
  return toRule(rule)
}

export async function deleteHostResourceMonitorRule(id: string) {
  await prisma.hostResourceMonitorRule.delete({ where: { id } })
}

export async function listHostResourceMonitorAlerts(ruleId?: string) {
  const records = await prisma.hostResourceMonitorAlert.findMany({ where: { ruleId }, orderBy: { createdAt: 'desc' }, take: 100 })
  return records.map(toAlertRecord)
}

async function triggerMetricAlert(rule: HostResourceMonitorRule, host: HostTarget, metric: HostResourceMetric, value: number, sampledAt: Date, state?: SustainedMetricState) {
  const label = metricLabels[metric]
  const durationMinutes = Math.max(1, rule.durationMinutes ?? 1)
  const hostInfo = `${hostTagText(host)}--${host.ip}--${hostNameText(host)}`
  const content = durationMinutes > 1
    ? `${hostInfo}；${label} 使用率已持续 ${durationMinutes} 分钟不低于 ${rule.threshold}%，最新值 ${value}%。窗口：${nowText(state?.windowStart ?? new Date(sampledAt.getTime() - durationMinutes * 60_000))} ~ ${nowText(sampledAt)}。`
    : `${hostInfo}；${label} 使用率 ${value}%，达到阈值 ${rule.threshold}%。`
  const notificationResults = await sendMonitorNotifications({ ruleNotification: rule.notification, content: `【${rule.alertLevel}】${rule.name}\n${content}\n时间：${nowText(sampledAt)}` })
  const result = await ingestAlert({
    level: rule.alertLevel,
    time: nowText(sampledAt),
    service: serviceText(host),
    title: `${rule.name}：${label}使用率过高`,
    content,
    owner: rule.notification.receivers || '主机资源监控',
    source: '主机资源监控',
    relatedType: 'host_resource_monitor_rule',
    relatedId: rule.id,
    fingerprint: `host-resource:${rule.id}:${host.id}:${metric}`,
    outboundNotification: { channels: ['站内告警'] },
    metadata: { ruleId: rule.id, ruleName: rule.name, hostId: host.id, sourceHostId: host.id, hostname: host.hostname, ip: host.ip, hostIp: host.ip, group: host.group, tags: host.tags || [], metric, actualValue: value, threshold: rule.threshold, durationMinutes, windowStart: state?.windowStart?.toISOString(), sampleCount: state?.sampleCount, sampledAt: sampledAt.toISOString() },
  })
  await prisma.$transaction([
    ...(result.alert ? [prisma.hostResourceMonitorAlert.create({ data: { ruleId: rule.id, alertId: result.alert.id, hostId: host.id, metric, value, threshold: rule.threshold, sampledAt, notificationResults } })] : []),
    prisma.hostResourceMonitorRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: sampledAt, lastEvaluatedAt: sampledAt, triggerCount: { increment: 1 } } }),
  ])
}

export async function evaluateHostResourceMonitorRule(rule: HostResourceMonitorRule, date = new Date()) {
  if (!rule.enabled) return { rule, evaluated: 0, triggered: 0, skippedReason: '规则已停用' }
  if (!isRuleActive(rule, date)) return { rule, evaluated: 0, triggered: 0, skippedReason: '不在生效周期内' }
  if (inCooldown(rule, date)) return { rule, evaluated: 0, triggered: 0, skippedReason: '处于冷却期' }
  const hosts = await prisma.host.findMany({ select: { id: true, ip: true, hostname: true, group: true, tags: true, cpu: true, memory: true, disk: true } })
  let evaluated = 0
  let triggered = 0
  for (const host of hosts) {
    if (!ruleMatchesHost(rule, host)) continue
    evaluated++
    for (const metric of rule.metrics) {
      const state = await getSustainedMetricState(rule, host, metric, date)
      if (state.matched) {
        await triggerMetricAlert(rule, host, metric, state.value, state.sampledAt, state)
        triggered++
      }
    }
  }
  await prisma.hostResourceMonitorRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: date } })
  return { rule, evaluated, triggered }
}

export async function evaluateHostResourceMonitorRulesForHost(hostId: string, sampledAt = new Date()) {
  const host = await prisma.host.findUnique({ where: { id: hostId }, select: { id: true, ip: true, hostname: true, group: true, tags: true, cpu: true, memory: true, disk: true } })
  if (!host) return []
  const rules = (await prisma.hostResourceMonitorRule.findMany({ where: { enabled: true } })).map(toRule)
  const results: Array<{ rule: HostResourceMonitorRule; evaluated: number; triggered: number; skippedReason?: string }> = []
  for (const rule of rules) {
    if (!ruleMatchesHost(rule, host)) continue
    if (!isRuleActive(rule, sampledAt)) { results.push({ rule, evaluated: 0, triggered: 0, skippedReason: '不在生效周期内' }); continue }
    if (inCooldown(rule, sampledAt)) { results.push({ rule, evaluated: 0, triggered: 0, skippedReason: '处于冷却期' }); continue }
    let triggered = 0
    for (const metric of rule.metrics) {
      const state = await getSustainedMetricState(rule, host, metric, sampledAt)
      if (state.matched) {
        await triggerMetricAlert(rule, host, metric, state.value, state.sampledAt, state)
        triggered++
      }
    }
    await prisma.hostResourceMonitorRule.update({ where: { id: rule.id }, data: { lastEvaluatedAt: sampledAt } })
    results.push({ rule, evaluated: 1, triggered })
  }
  return results
}
