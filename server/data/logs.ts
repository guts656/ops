import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma.ts'
import type { AgentLogInput, AppLog, LogFilters } from '../types/log'
import { shanghaiTime } from '../utils/time'

type LogRow = NonNullable<Awaited<ReturnType<typeof prisma.appLog.findFirst>>>

const DEFAULT_LOG_RETENTION_DAYS = 2
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_FUTURE_LOG_MS = 5 * 60 * 1000
const DEFAULT_QUERY_WINDOW_MS = 60 * 60 * 1000

function toLog(log: LogRow): AppLog {
  return {
    id: log.id,
    time: timeText(log.timestamp),
    timestamp: log.timestamp.toISOString(),
    service: log.service,
    level: log.level as AppLog['level'],
    traceId: log.traceId,
    message: log.message,
    hostId: log.hostId || undefined,
    source: log.source || undefined,
    labels: log.labels ?? undefined,
    rawPayload: log.rawPayload ?? undefined,
    ingestedAt: log.ingestedAt.toISOString(),
  }
}

function timeText(date: Date) {
  return shanghaiTime(date)
}

function logId(hostId: string, index: number) {
  return `agent-log-${Date.now().toString(36)}-${hostId.slice(-6)}-${index}-${Math.random().toString(36).slice(2, 8)}`
}

function traceId(hostId: string, index: number, value?: string) {
  return value?.trim() || `agent-${hostId.slice(-8)}-${Date.now().toString(36)}-${index}`
}

function dbSafeText(value: string) {
  return value.replace(new RegExp(String.fromCharCode(0), 'g'), '')
}

function compactText(value: string, maxLength: number) {
  const text = dbSafeText(value)
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function compactMessage(message: string) {
  return compactText(message, 2000)
}

function sanitizeJsonValue(value: unknown): unknown {
  if (typeof value === 'string') return dbSafeText(value)
  if (Array.isArray(value)) return value.map(sanitizeJsonValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [dbSafeText(key), sanitizeJsonValue(item)]))
  }
  return value
}

function pageValue(value: number | undefined, fallback: number, max: number) {
  if (!value || Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(1, value))
}

function retentionDays() {
  const value = Number(process.env.LOG_RETENTION_DAYS || DEFAULT_LOG_RETENTION_DAYS)
  if (!Number.isFinite(value) || value < 1) return DEFAULT_LOG_RETENTION_DAYS
  return Math.floor(value)
}

function shanghaiDateParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date)
  return Object.fromEntries(parts.map((part) => [part.type, part.value])) as { year: string; month: string; day: string }
}

export function startOfShanghaiTodayUtc(now = new Date()) {
  const parts = shanghaiDateParts(now)
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 8 * 60 * 60 * 1000)
}

export function logRetentionCutoffUtc(now = new Date()) {
  return new Date(startOfShanghaiTodayUtc(now).getTime() - (retentionDays() - 1) * DAY_MS)
}

function expandDateTemplate(value: string | undefined, date = new Date()) {
  if (!value) return undefined
  const parts = shanghaiDateParts(date)
  return value
    .replaceAll('%Y', parts.year)
    .replaceAll('%m', parts.month)
    .replaceAll('%d', parts.day)
}

function sourceWhere(source: string | undefined, date = new Date()): Prisma.AppLogWhereInput | undefined {
  const value = expandDateTemplate(source?.trim(), date)
  if (!value) return undefined
  if (value === 'file') return { source: { notIn: ['docker', 'eventlog:Application', 'eventlog:System', 'smoke'] } }
  if (value.endsWith('\\') || value.endsWith('/')) return { source: { startsWith: value } }
  if (/^[a-zA-Z]:[\\/][^*?]*$/.test(value) && !/\.(log|txt|out|err)$/i.test(value)) {
    return { OR: [{ source: value }, { source: { startsWith: value.endsWith('\\') ? value : `${value}\\` } }] }
  }
  if (value.startsWith('/') && !/\.(log|txt|out|err)$/i.test(value)) {
    return { OR: [{ source: value }, { source: { startsWith: value.endsWith('/') ? value : `${value}/` } }] }
  }
  return { source: value }
}

export async function cleanupOldAppLogs(now = new Date()) {
  return prisma.appLog.deleteMany({ where: { timestamp: { lt: logRetentionCutoffUtc(now) } } })
}

export async function queryLogs(filters: LogFilters) {
  const page = pageValue(filters.page, 1, 100000)
  const pageSize = pageValue(filters.pageSize, 20, 100)
  const keyword = filters.keyword?.trim()
  const serviceFilter = filters.service?.startsWith('container:') ? { contains: filters.service, mode: 'insensitive' as const } : filters.service
  const clauses: Prisma.AppLogWhereInput[] = []
  const sourceFilter = sourceWhere(filters.source)
  if (sourceFilter) clauses.push(sourceFilter)
  if (keyword) clauses.push({ OR: [{ traceId: { contains: keyword, mode: 'insensitive' } }, { message: { contains: keyword, mode: 'insensitive' } }, { service: { contains: keyword, mode: 'insensitive' } }] })
  const now = new Date()
  const where: Prisma.AppLogWhereInput = {
    service: serviceFilter,
    level: filters.level,
    hostId: filters.hostId,
    timestamp: {
      gte: filters.startTime ? new Date(filters.startTime) : new Date(Math.max(logRetentionCutoffUtc(now).getTime(), now.getTime() - DEFAULT_QUERY_WINDOW_MS)),
      lte: filters.endTime ? new Date(filters.endTime) : undefined,
    },
    AND: clauses.length ? clauses : undefined,
  }

  const rows = await prisma.appLog.findMany({ where, orderBy: { timestamp: 'desc' }, skip: (page - 1) * pageSize, take: pageSize + 1 })
  const hasMore = rows.length > pageSize
  const data = hasMore ? rows.slice(0, pageSize) : rows
  const total = hasMore ? page * pageSize + 1 : (page - 1) * pageSize + data.length

  return { data: data.map(toLog), total, page, pageSize }
}

export async function getLogServices() {
  const cutoff = new Date(Math.max(logRetentionCutoffUtc().getTime(), Date.now() - DEFAULT_QUERY_WINDOW_MS))
  const [logRows, containers] = await Promise.all([
    prisma.appLog.findMany({ where: { timestamp: { gte: cutoff } }, distinct: ['service'], select: { service: true }, orderBy: { service: 'asc' }, take: 500 }),
    prisma.hostContainer.findMany({ where: { isCurrent: true }, select: { name: true }, orderBy: { name: 'asc' }, take: 500 }),
  ])
  const values = new Set(logRows.map((row) => row.service))
  for (const container of containers) values.add(`container:${container.name}`)
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

function shouldStoreLog(log: AgentLogInput) {
  return ['ERROR', 'WARN', 'INFO', 'DEBUG'].includes(log.level)
}

export async function ingestAgentLogs(hostId: string, logs: AgentLogInput[]) {
  const now = new Date()
  const cutoff = logRetentionCutoffUtc(now)
  const latestAllowed = new Date(now.getTime() + MAX_FUTURE_LOG_MS)
  const rows = logs.filter(shouldStoreLog).map((log, index) => {
    const timestamp = log.timestamp ? new Date(log.timestamp) : now
    return {
      id: logId(hostId, index),
      time: timeText(timestamp),
      timestamp,
      service: compactText(log.service, 200),
      level: log.level,
      traceId: compactText(traceId(hostId, index, log.traceId), 200),
      message: compactMessage(log.message),
      hostId,
      source: log.source ? compactText(log.source, 500) : 'agent',
      labels: sanitizeJsonValue(log.labels) as Prisma.InputJsonValue | undefined,
      rawPayload: sanitizeJsonValue(log.rawPayload) as Prisma.InputJsonValue | undefined,
    }
  })
  const retainedRows = rows.filter((row) => !Number.isNaN(row.timestamp.getTime()) && row.timestamp >= cutoff && row.timestamp <= latestAllowed)
  const traceIds = retainedRows.map((row) => row.traceId)
  const existing = traceIds.length ? await prisma.appLog.findMany({ where: { hostId, traceId: { in: traceIds } }, select: { traceId: true } }) : []
  const existingTraceIds = new Set(existing.map((row) => row.traceId))
  const pendingRows = retainedRows.filter((row) => !existingTraceIds.has(row.traceId))
  if (pendingRows.length) await prisma.appLog.createMany({ data: pendingRows })
  return pendingRows.length
}
