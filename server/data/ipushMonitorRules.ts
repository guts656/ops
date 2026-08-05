import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { resolveAlert } from './alerts'
import { isHostInMaintenance } from './hosts'
import { ingestAlert } from '../services/alertIngestionService'
import { probeIpush } from '../services/ipushProbe'
import type { IpushEvaluateResult, IpushMonitorAlertRecord, IpushMonitorNotification, IpushMonitorRule, IpushMonitorRuleInput, IpushMonitorTimeRange, IpushProbeResult } from '../types/ipushMonitor'
import { decryptSecret, encryptSecret } from '../utils/credentialCrypto'
import { shanghaiTime } from '../utils/time'

type IpushMonitorRuleRow = NonNullable<Awaited<ReturnType<typeof prisma.ipushMonitorRule.findFirst>>>
type IpushMonitorAlertRow = NonNullable<Awaited<ReturnType<typeof prisma.ipushMonitorAlert.findFirst>>>

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const next = Math.floor(Number(value ?? fallback))
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}

function compact(value: string, maxLength = 2000) {
  return value.replace(/\u0000/g, '').slice(0, maxLength)
}

function normalizeToken(value: string, label: string) {
  const token = value.trim()
  if (!token) throw new Error(`${label}不能为空`)
  if (token.length > 120) throw new Error(`${label}不能超过 120 个字符`)
  if (/\s|[\u0000-\u001f\u007f]/.test(token)) throw new Error(`${label}不能包含空格、换行或控制字符`)
  return token
}

function normalizeTargetHost(value: string) {
  const host = value.trim()
  if (!host || host.length > 253 || !/^[a-zA-Z0-9_.:-]+$/.test(host)) throw new Error('目标主机必须是有效的 IP 或主机名')
  return host
}

function normalizeTimeRanges(ranges: IpushMonitorTimeRange[] | undefined) {
  return (ranges ?? [])
    .map((range) => ({ start: range.start?.trim(), end: range.end?.trim() }))
    .filter((range) => /^\d{2}:\d{2}$/.test(range.start) && /^\d{2}:\d{2}$/.test(range.end) && range.start < range.end)
    .slice(0, 8)
}

function normalizeHolidays(values: string[] | undefined) {
  return Array.from(new Set((values ?? []).map((value) => value.trim()).filter((value) => /^\d{4}-\d{2}-\d{2}$/.test(value)))).slice(0, 80)
}

function notificationValue(value: unknown): IpushMonitorNotification {
  const notification = value as Partial<IpushMonitorNotification> | undefined
  return { receivers: notification?.receivers || undefined }
}

function toRule(rule: IpushMonitorRuleRow): IpushMonitorRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    enabled: rule.enabled,
    hostId: rule.hostId ?? undefined,
    targetHost: rule.targetHost,
    port: rule.port,
    systemCode: rule.systemCode,
    serviceCode: rule.serviceCode,
    username: rule.username,
    passwordConfigured: Boolean(rule.encryptedPassword),
    expectedGreeting: rule.expectedGreeting,
    expectedLoginResult: rule.expectedLoginResult,
    connectTimeoutMs: rule.connectTimeoutMs,
    responseTimeoutMs: rule.responseTimeoutMs,
    intervalSeconds: rule.intervalSeconds,
    failureThreshold: rule.failureThreshold,
    cooldownMinutes: rule.cooldownMinutes,
    alertLevel: rule.alertLevel as IpushMonitorRule['alertLevel'],
    daysOfWeek: rule.daysOfWeek,
    timeRanges: Array.isArray(rule.timeRanges) ? rule.timeRanges as unknown as IpushMonitorTimeRange[] : [],
    holidayMode: rule.holidayMode as IpushMonitorRule['holidayMode'],
    holidays: rule.holidays,
    notification: notificationValue(rule.notification),
    lastCheckedAt: rule.lastCheckedAt?.toISOString(),
    lastTriggeredAt: rule.lastTriggeredAt?.toISOString(),
    lastHealthyAt: rule.lastHealthyAt?.toISOString(),
    consecutiveFailures: rule.consecutiveFailures,
    triggerCount: rule.triggerCount,
    lastReachable: rule.lastReachable ?? undefined,
    lastLatencyMs: rule.lastLatencyMs ?? undefined,
    lastStage: rule.lastStage,
    lastError: rule.lastError ?? undefined,
    lastResponseSnippet: rule.lastResponseSnippet,
    createdAt: rule.createdAt.toISOString(),
    updatedAt: rule.updatedAt.toISOString(),
  }
}

function toAlertRecord(record: IpushMonitorAlertRow): IpushMonitorAlertRecord {
  return {
    id: record.id,
    ruleId: record.ruleId,
    alertId: record.alertId,
    stage: record.stage,
    reachable: record.reachable,
    latencyMs: record.latencyMs ?? undefined,
    responseSnippet: record.responseSnippet,
    errorMessage: record.errorMessage,
    notificationResults: record.notificationResults,
    createdAt: record.createdAt.toISOString(),
  }
}

async function ruleData(input: IpushMonitorRuleInput, existing?: IpushMonitorRuleRow) {
  const password = input.password ? normalizeToken(input.password, '密码') : ''
  if (!existing && !password) throw new Error('新建 iPush 监控必须填写密码')
  const encrypted = password ? encryptSecret(password) : undefined
  const hostId = input.hostId?.trim() || null
  if (hostId && !await prisma.host.findUnique({ where: { id: hostId }, select: { id: true } })) throw new Error('关联主机不存在')
  return {
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    enabled: input.enabled ?? true,
    hostId,
    targetHost: normalizeTargetHost(input.targetHost),
    port: clampInt(input.port, 0, 1, 65535),
    systemCode: normalizeToken(input.systemCode, '系统标识'),
    serviceCode: normalizeToken(input.serviceCode, '服务标识'),
    username: normalizeToken(input.username, '账号'),
    ...(encrypted ? { encryptedPassword: encrypted.encryptedSecret, passwordIv: encrypted.secretIv, passwordTag: encrypted.secretTag } : {}),
    expectedGreeting: input.expectedGreeting?.trim() || 'xinit',
    expectedLoginResult: input.expectedLoginResult?.trim() || 'xaucode 200_login_ok',
    connectTimeoutMs: clampInt(input.connectTimeoutMs, 5000, 500, 60000),
    responseTimeoutMs: clampInt(input.responseTimeoutMs, 5000, 500, 60000),
    intervalSeconds: clampInt(input.intervalSeconds, 60, 10, 86400),
    failureThreshold: clampInt(input.failureThreshold, 3, 1, 100),
    cooldownMinutes: clampInt(input.cooldownMinutes, 30, 1, 1440),
    alertLevel: input.alertLevel ?? '严重',
    daysOfWeek: Array.from(new Set((input.daysOfWeek ?? []).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))).sort(),
    timeRanges: normalizeTimeRanges(input.timeRanges) as unknown as Prisma.InputJsonValue,
    holidayMode: input.holidayMode ?? 'ignore',
    holidays: normalizeHolidays(input.holidays),
    notification: notificationValue(input.notification) as unknown as Prisma.InputJsonValue,
  }
}

function localDateParts(date: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const dateText = `${parts.year}-${parts.month}-${parts.day}`
  const weekday = new Date(`${dateText}T00:00:00+08:00`).getUTCDay() || 7
  return { date: dateText, time: `${parts.hour}:${parts.minute}`, weekday }
}

function isRuleActive(rule: IpushMonitorRule, date: Date) {
  const current = localDateParts(date)
  if (rule.daysOfWeek.length && !rule.daysOfWeek.includes(current.weekday)) return false
  const holidayMatched = rule.holidays.includes(current.date)
  if (rule.holidayMode === 'include' && !holidayMatched) return false
  if (rule.holidayMode === 'exclude' && holidayMatched) return false
  if (rule.timeRanges.length && !rule.timeRanges.some((range) => current.time >= range.start && current.time <= range.end)) return false
  return true
}

function isDue(rule: IpushMonitorRule, date: Date) {
  return !rule.lastCheckedAt || date.getTime() - new Date(rule.lastCheckedAt).getTime() >= rule.intervalSeconds * 1000
}

function inCooldown(rule: IpushMonitorRule, date: Date) {
  return Boolean(rule.lastTriggeredAt && date.getTime() - new Date(rule.lastTriggeredAt).getTime() < rule.cooldownMinutes * 60_000)
}

function stageText(stage: string) {
  if (stage === 'connect') return 'TCP连接'
  if (stage === 'greeting') return '等待xinit'
  if (stage === 'login') return 'xlogin认证'
  return '健康'
}

async function resolveRecoveredAlerts(ruleId: string) {
  const alerts = await prisma.alert.findMany({ where: { relatedType: 'ipush_monitor_rule', relatedId: ruleId, status: { not: '已解决' } }, select: { id: true, metadata: true } })
  for (const alert of alerts) {
    const metadata = alert.metadata && typeof alert.metadata === 'object' && !Array.isArray(alert.metadata) ? alert.metadata as Record<string, unknown> : {}
    await prisma.alert.update({ where: { id: alert.id }, data: { metadata: { ...metadata, recoveredAfterResolve: true } as Prisma.InputJsonValue } })
    await resolveAlert(alert.id, 'iPush监控')
  }
}

async function createAlertForRule(rule: IpushMonitorRule, result: IpushProbeResult, failures: number, date: Date) {
  if (rule.hostId && await isHostInMaintenance(rule.hostId, date)) return []
  const target = `${rule.targetHost}:${rule.port}`
  const alertResult = await ingestAlert({
    level: rule.alertLevel,
    time: shanghaiTime(date),
    service: target,
    title: `iPush异常：${rule.name}`,
    content: [
      `iPush监控「${rule.name}」连续异常 ${failures} 次，达到阈值 ${rule.failureThreshold} 次。`,
      `目标：${target}`,
      `失败阶段：${stageText(result.stage)}`,
      `协议检查：连接后等待 ${rule.expectedGreeting}，发送 xlogin 后等待 ${rule.expectedLoginResult}`,
      `耗时：${result.latencyMs}ms`,
      result.errorMessage ? `异常原因：${result.errorMessage}` : undefined,
      result.responseSnippet ? `脱敏响应：${result.responseSnippet.slice(0, 300)}` : undefined,
    ].filter(Boolean).join('\n'),
    owner: rule.notification.receivers || 'iPush监控',
    source: 'iPush监控',
    relatedType: 'ipush_monitor_rule',
    relatedId: rule.id,
    fingerprint: `ipush-monitor:${rule.id}`,
    metadata: {
      ruleId: rule.id,
      ruleName: rule.name,
      ...(rule.hostId ? { hostId: rule.hostId, sourceHostId: rule.hostId } : {}),
      targetHost: rule.targetHost,
      port: rule.port,
      stage: result.stage,
      latencyMs: result.latencyMs,
      consecutiveFailures: failures,
    },
  })
  const notificationResults = alertResult.notificationResults ?? []
  await prisma.$transaction([
    ...(alertResult.alert ? [prisma.ipushMonitorAlert.create({ data: { ruleId: rule.id, alertId: alertResult.alert.id, stage: result.stage, reachable: result.reachable, latencyMs: result.latencyMs, responseSnippet: result.responseSnippet, errorMessage: result.errorMessage ?? '', notificationResults } })] : []),
    prisma.ipushMonitorRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: date, triggerCount: { increment: 1 } } }),
  ])
  return notificationResults
}

export async function listIpushMonitorRules() {
  return (await prisma.ipushMonitorRule.findMany({ orderBy: { createdAt: 'desc' } })).map(toRule)
}

export async function getIpushMonitorRule(id: string) {
  const rule = await prisma.ipushMonitorRule.findUnique({ where: { id } })
  return rule ? toRule(rule) : undefined
}

export async function createIpushMonitorRule(input: IpushMonitorRuleInput) {
  const data = await ruleData(input)
  const { encryptedPassword, passwordIv, passwordTag, ...rest } = data
  if (!encryptedPassword || !passwordIv || !passwordTag) throw new Error('新建 iPush 监控必须填写密码')
  return toRule(await prisma.ipushMonitorRule.create({ data: { ...rest, encryptedPassword, passwordIv, passwordTag } }))
}

export async function updateIpushMonitorRule(id: string, input: IpushMonitorRuleInput) {
  const existing = await prisma.ipushMonitorRule.findUnique({ where: { id } })
  if (!existing) return undefined
  return toRule(await prisma.ipushMonitorRule.update({ where: { id }, data: await ruleData(input, existing) }))
}

export async function deleteIpushMonitorRule(id: string) {
  await prisma.ipushMonitorRule.delete({ where: { id } })
}

export async function listIpushMonitorAlerts(ruleId?: string) {
  return (await prisma.ipushMonitorAlert.findMany({ where: { ruleId }, orderBy: { createdAt: 'desc' }, take: 100 })).map(toAlertRecord)
}

export async function evaluateIpushMonitorRule(rule: IpushMonitorRule, date = new Date(), options: { force?: boolean } = {}): Promise<IpushEvaluateResult> {
  if (!rule.enabled) return { checked: false, triggered: false, ok: false, reachable: false, stage: 'connect', latencyMs: 0, responseSnippet: '', consecutiveFailures: rule.consecutiveFailures, skippedReason: '规则已停用' }
  if (!isRuleActive(rule, date)) return { checked: false, triggered: false, ok: false, reachable: false, stage: 'connect', latencyMs: 0, responseSnippet: '', consecutiveFailures: rule.consecutiveFailures, skippedReason: '不在生效周期内' }
  if (!options.force && !isDue(rule, date)) return { checked: false, triggered: false, ok: true, reachable: true, stage: 'healthy', latencyMs: 0, responseSnippet: '', consecutiveFailures: rule.consecutiveFailures, skippedReason: '未到检查间隔' }

  const row = await prisma.ipushMonitorRule.findUnique({ where: { id: rule.id } })
  if (!row) throw new Error('iPush监控规则不存在')
  let result: IpushProbeResult
  try {
    const password = decryptSecret({ encryptedSecret: row.encryptedPassword, secretIv: row.passwordIv, secretTag: row.passwordTag })
    result = await probeIpush({ ...rule, password })
  } catch (error) {
    result = { ok: false, reachable: false, stage: 'login', latencyMs: 0, responseSnippet: '', errorMessage: `监控凭据无法解密：${error instanceof Error ? error.message : String(error)}` }
  }

  const failures = result.ok ? 0 : rule.consecutiveFailures + 1
  await prisma.ipushMonitorRule.update({
    where: { id: rule.id },
    data: {
      lastCheckedAt: date,
      lastHealthyAt: result.ok ? date : undefined,
      lastReachable: result.reachable,
      lastLatencyMs: result.latencyMs,
      lastStage: result.stage,
      lastError: result.ok ? null : compact(result.errorMessage ?? '未知异常', 1000),
      lastResponseSnippet: compact(result.responseSnippet),
      consecutiveFailures: failures,
    },
  })

  if (result.ok && rule.consecutiveFailures > 0) await resolveRecoveredAlerts(rule.id)
  let triggered = false
  let notificationResults: string[] = []
  if (!result.ok && failures >= rule.failureThreshold && !inCooldown(rule, date)) {
    notificationResults = await createAlertForRule(rule, result, failures, date)
    triggered = true
  }
  return { ...result, checked: true, triggered, consecutiveFailures: failures, notificationResults }
}

export async function evaluateIpushMonitorRulesOnce() {
  const results: IpushEvaluateResult[] = []
  for (const rule of await listIpushMonitorRules()) results.push(await evaluateIpushMonitorRule(rule))
  return results
}
