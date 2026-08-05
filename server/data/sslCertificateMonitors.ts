import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { ingestAlert } from '../services/alertIngestionService'
import { checkSslCertificate, isValidSslDomain, type SslAlertLevel, type SslCertificateStatus } from '../services/sslCertificateChecker'
import { shanghaiTime } from '../utils/time'

export type SslCertificatePlatformLevel = '紧急' | '严重' | '警告' | '提示'

export interface SslCertificateNotification {
  receivers?: string
}

export interface SslCertificateMonitorInput {
  name: string
  description?: string
  enabled?: boolean
  domain: string
  serverIp?: string
  port?: number
  thresholds?: number[]
  checkTime?: string
  alertLevel?: SslCertificatePlatformLevel
  notification?: SslCertificateNotification
}

export interface SslCertificateMonitor extends Required<Omit<SslCertificateMonitorInput, 'notification' | 'serverIp' | 'validFrom' | 'validTo'>> {
  id: string
  description: string
  serverIp?: string
  issuer: string
  validFrom?: string
  validTo?: string
  remainingDays: number | null
  domainMatched: boolean
  status: SslCertificateStatus | 'unknown'
  notification: SslCertificateNotification
  lastCheckedAt?: string
  nextCheckAt?: string
  lastTriggeredAt?: string
  triggerCount: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface SslCertificateHistory {
  id: string
  monitorId: string
  alertId?: string
  domain: string
  serverIp?: string
  port: number
  checkedAt: string
  status: SslCertificateStatus
  issuer: string
  validFrom?: string
  validTo?: string
  remainingDays: number | null
  domainMatched: boolean
  alertLevel: SslAlertLevel
  matchedThreshold?: number
  notificationResults: string[]
  errorMessage?: string
  createdAt: string
}

type MonitorRow = NonNullable<Awaited<ReturnType<typeof prisma.sslCertificateMonitor.findFirst>>>
type HistoryRow = NonNullable<Awaited<ReturnType<typeof prisma.sslCertificateHistory.findFirst>>>

const defaultThresholds = [30, 15, 7]

function compact(value: string | undefined | null, maxLength = 2000) {
  return String(value ?? '').replace(/\0/g, '').slice(0, maxLength)
}

function clampInt(value: number | undefined, fallback: number, min: number, max: number) {
  const next = Math.floor(Number(value ?? fallback))
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}

function normalizeDomain(value: string) {
  const domain = value.trim().toLowerCase()
  if (!isValidSslDomain(domain)) throw new Error('请输入合法域名，不包含协议、路径、端口或本机地址')
  return domain
}

function normalizeThresholds(values?: number[]) {
  const source = values?.length ? values : defaultThresholds
  const thresholds = source.map(Number).filter((value) => Number.isInteger(value) && value >= 1 && value <= 365)
  if (!thresholds.length) return defaultThresholds
  return Array.from(new Set(thresholds)).sort((a, b) => b - a)
}

function normalizeCheckTime(value?: string) {
  const text = value?.trim() || '08:30'
  if (!/^\d{2}:\d{2}$/.test(text)) return '08:30'
  const [hour, minute] = text.split(':').map(Number)
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return '08:30'
  return text
}

function notificationValue(value: unknown): SslCertificateNotification {
  const notification = value as Partial<SslCertificateNotification> | undefined
  return {
    receivers: notification?.receivers || undefined,
  }
}

function nextCheckAt(from = new Date(), checkTime = '08:30') {
  const [hour, minute] = normalizeCheckTime(checkTime).split(':').map(Number)
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(from)
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value])) as { year: string; month: string; day: string }
  const next = new Date(Date.UTC(Number(map.year), Number(map.month) - 1, Number(map.day), hour - 8, minute, 0, 0))
  if (next <= from) next.setUTCDate(next.getUTCDate() + 1)
  return next
}

function matchedThreshold(remainingDays: number | null, thresholds: number[]) {
  if (typeof remainingDays !== 'number') return undefined
  return thresholds.filter((threshold) => remainingDays <= threshold).sort((a, b) => b - a)[0]
}

function shouldTrigger(status: SslCertificateStatus, remainingDays: number | null, thresholds: number[]) {
  if (status === 'expired' || status === 'failed') return true
  if (status !== 'expiring') return false
  return Boolean(matchedThreshold(remainingDays, thresholds))
}

function platformAlertLevel(monitorLevel: SslCertificatePlatformLevel, status: SslCertificateStatus) {
  if (status === 'expired' || status === 'failed') return monitorLevel === '提示' || monitorLevel === '警告' ? '严重' : monitorLevel
  return monitorLevel
}

function toMonitor(row: MonitorRow): SslCertificateMonitor {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    domain: row.domain,
    serverIp: row.serverIp ?? undefined,
    port: row.port,
    issuer: row.issuer,
    validFrom: row.validFrom?.toISOString(),
    validTo: row.validTo?.toISOString(),
    remainingDays: row.remainingDays,
    domainMatched: row.domainMatched,
    status: row.status as SslCertificateMonitor['status'],
    thresholds: row.thresholds,
    checkTime: row.checkTime,
    alertLevel: row.alertLevel as SslCertificatePlatformLevel,
    notification: notificationValue(row.notification),
    lastCheckedAt: row.lastCheckedAt?.toISOString(),
    nextCheckAt: row.nextCheckAt?.toISOString(),
    lastTriggeredAt: row.lastTriggeredAt?.toISOString(),
    triggerCount: row.triggerCount,
    lastError: row.lastError ?? undefined,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function toHistory(row: HistoryRow): SslCertificateHistory {
  return {
    id: row.id,
    monitorId: row.monitorId,
    alertId: row.alertId ?? undefined,
    domain: row.domain,
    serverIp: row.serverIp ?? undefined,
    port: row.port,
    checkedAt: row.checkedAt.toISOString(),
    status: row.status as SslCertificateStatus,
    issuer: row.issuer,
    validFrom: row.validFrom?.toISOString(),
    validTo: row.validTo?.toISOString(),
    remainingDays: row.remainingDays,
    domainMatched: row.domainMatched,
    alertLevel: row.alertLevel as SslAlertLevel,
    matchedThreshold: row.matchedThreshold ?? undefined,
    notificationResults: row.notificationResults,
    errorMessage: row.errorMessage ?? undefined,
    createdAt: row.createdAt.toISOString(),
  }
}

function monitorData(input: SslCertificateMonitorInput) {
  const thresholds = normalizeThresholds(input.thresholds)
  const checkTime = normalizeCheckTime(input.checkTime)
  const domain = normalizeDomain(input.domain)
  return {
    name: compact(input.name, 80).trim() || domain,
    description: compact(input.description, 300),
    enabled: input.enabled ?? true,
    domain,
    serverIp: compact(input.serverIp, 100).trim() || null,
    port: clampInt(input.port, 443, 1, 65535),
    thresholds,
    checkTime,
    alertLevel: input.alertLevel ?? '警告',
    notification: notificationValue(input.notification) as unknown as Prisma.InputJsonValue,
    nextCheckAt: nextCheckAt(new Date(), checkTime),
  }
}

async function appendAudit(operator: string, action: string, target: string, result: '成功' | '失败' = '成功', detail = '') {
  await prisma.auditLog.create({ data: { operator, action, target, result, detail } })
}

async function pruneHistories(monitorId: string) {
  const old = await prisma.sslCertificateHistory.findMany({ where: { monitorId }, orderBy: { checkedAt: 'desc' }, skip: 100, select: { id: true } })
  if (old.length) await prisma.sslCertificateHistory.deleteMany({ where: { id: { in: old.map((item) => item.id) } } })
}

async function createAlertForMonitor(monitor: MonitorRow, status: SslCertificateStatus, matched: number | undefined, checkedAt: Date) {
  const level = platformAlertLevel(monitor.alertLevel as SslCertificatePlatformLevel, status)
  const content = [
    `SSL 证书监控「${monitor.name}」检测异常。`,
    `域名：${monitor.domain}:${monitor.port}`,
    monitor.serverIp ? `服务器 IP：${monitor.serverIp}` : undefined,
    monitor.validTo ? `到期时间：${shanghaiTime(monitor.validTo)}` : undefined,
    typeof monitor.remainingDays === 'number' ? `剩余天数：${monitor.remainingDays} 天` : undefined,
    matched ? `命中阈值：${matched} 天` : undefined,
    `域名匹配：${monitor.domainMatched ? '匹配' : '不匹配'}`,
    monitor.issuer ? `颁发者：${monitor.issuer}` : undefined,
    monitor.lastError ? `错误信息：${monitor.lastError}` : undefined,
  ].filter(Boolean).join('\n')

  const result = await ingestAlert({
    level,
    time: shanghaiTime(checkedAt),
    service: `${monitor.domain}:${monitor.port}`,
    title: `SSL证书${status === 'expired' ? '已过期' : status === 'failed' ? '检测失败' : '即将过期'}：${monitor.domain}`,
    content,
    owner: notificationValue(monitor.notification).receivers || 'SSL证书监控',
    source: 'SSL证书监控',
    relatedType: 'ssl_certificate_monitor',
    relatedId: monitor.id,
    fingerprint: `ssl-certificate:${monitor.id}:${status}:${matched ?? 'critical'}`,
    metadata: {
      monitorId: monitor.id,
      monitorName: monitor.name,
      domain: monitor.domain,
      port: monitor.port,
      serverIp: monitor.serverIp,
      validTo: monitor.validTo?.toISOString(),
      remainingDays: monitor.remainingDays,
      domainMatched: monitor.domainMatched,
      matchedThreshold: matched,
      status,
    },
  })
  if (result.alert) {
    await prisma.sslCertificateMonitor.update({ where: { id: monitor.id }, data: { lastTriggeredAt: checkedAt, triggerCount: { increment: 1 } } })
  }
  return { alertId: result.alert?.id, notificationResults: result.notificationResults ?? [] }
}

export async function listSslCertificateMonitors() {
  const rows = await prisma.sslCertificateMonitor.findMany({ orderBy: { createdAt: 'desc' } })
  return rows.map(toMonitor)
}

export async function getSslCertificateMonitor(id: string) {
  const row = await prisma.sslCertificateMonitor.findUnique({ where: { id } })
  return row ? toMonitor(row) : undefined
}

export async function listSslCertificateHistories(monitorId?: string) {
  const rows = await prisma.sslCertificateHistory.findMany({ where: { monitorId }, orderBy: { checkedAt: 'desc' }, take: 200 })
  return rows.map(toHistory)
}

export async function createSslCertificateMonitor(input: SslCertificateMonitorInput, operator = '系统') {
  const row = await prisma.sslCertificateMonitor.create({ data: monitorData(input) })
  await appendAudit(operator, '新增SSL证书监控', `${row.domain}:${row.port}`, '成功', row.name)
  await checkSslCertificateMonitorNow(row.id, { manual: true })
  return getSslCertificateMonitor(row.id)
}

export async function updateSslCertificateMonitor(id: string, input: SslCertificateMonitorInput, operator = '系统') {
  const row = await prisma.sslCertificateMonitor.update({ where: { id }, data: monitorData(input) })
  await appendAudit(operator, '更新SSL证书监控', `${row.domain}:${row.port}`, '成功', row.name)
  await checkSslCertificateMonitorNow(row.id, { manual: true })
  return getSslCertificateMonitor(row.id)
}

export async function deleteSslCertificateMonitor(id: string, operator = '系统') {
  const row = await prisma.sslCertificateMonitor.findUnique({ where: { id } })
  if (!row) return undefined
  await prisma.sslCertificateMonitor.delete({ where: { id } })
  await appendAudit(operator, '删除SSL证书监控', `${row.domain}:${row.port}`, '成功', row.name)
  return toMonitor(row)
}

export async function checkSslCertificateMonitorNow(id: string, options: { manual?: boolean } = {}) {
  const monitor = await prisma.sslCertificateMonitor.findUnique({ where: { id } })
  if (!monitor) return undefined
  const checkedAt = new Date()
  const thresholds = normalizeThresholds(monitor.thresholds)
  const result = await checkSslCertificate(monitor.domain, monitor.port, thresholds)
  const matched = matchedThreshold(result.remainingDays, thresholds)
  const trigger = shouldTrigger(result.status, result.remainingDays, thresholds)
  const updated = await prisma.sslCertificateMonitor.update({
    where: { id },
    data: {
      issuer: result.issuer,
      validFrom: result.validFrom ?? null,
      validTo: result.validTo ?? null,
      remainingDays: result.remainingDays,
      domainMatched: result.domainMatched,
      status: result.status,
      lastCheckedAt: checkedAt,
      nextCheckAt: nextCheckAt(checkedAt, monitor.checkTime),
      lastError: result.errorMessage ? compact(result.errorMessage, 1000) : null,
    },
  })

  const alertResult = trigger ? await createAlertForMonitor(updated, result.status, matched, checkedAt) : undefined
  const alertId = alertResult?.alertId
  const notificationResults = alertResult?.notificationResults ?? []
  const history = await prisma.sslCertificateHistory.create({
    data: {
      monitorId: monitor.id,
      alertId,
      domain: monitor.domain,
      serverIp: monitor.serverIp,
      port: monitor.port,
      checkedAt,
      status: result.status,
      issuer: result.issuer,
      validFrom: result.validFrom ?? null,
      validTo: result.validTo ?? null,
      remainingDays: result.remainingDays,
      domainMatched: result.domainMatched,
      alertLevel: result.alertLevel,
      matchedThreshold: matched,
      notificationResults,
      errorMessage: result.errorMessage,
    },
  })
  await pruneHistories(monitor.id)
  if (options.manual) await appendAudit('SSL证书监控', '手动检测SSL证书', `${monitor.domain}:${monitor.port}`, result.status === 'failed' ? '失败' : '成功', result.errorMessage || `剩余 ${result.remainingDays ?? '-'} 天`)
  return { monitor: toMonitor(updated), history: toHistory(history), triggered: trigger, notificationResults }
}

export async function evaluateDueSslCertificateMonitorsOnce(date = new Date()) {
  const rows = await prisma.sslCertificateMonitor.findMany({ where: { enabled: true, OR: [{ nextCheckAt: null }, { nextCheckAt: { lte: date } }] }, orderBy: { nextCheckAt: 'asc' }, take: 5 })
  const results = []
  for (const row of rows) results.push(await checkSslCertificateMonitorNow(row.id))
  return results
}
