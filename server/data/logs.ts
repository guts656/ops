import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma.ts'
import type { AgentLogInput, AppLog, LogFilters } from '../types/log'
import { shanghaiTime } from '../utils/time'

type LogRow = NonNullable<Awaited<ReturnType<typeof prisma.appLog.findFirst>>>

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

function compactMessage(message: string) {
  return message.length > 2000 ? message.slice(0, 2000) : message
}

function pageValue(value: number | undefined, fallback: number, max: number) {
  if (!value || Number.isNaN(value)) return fallback
  return Math.min(max, Math.max(1, value))
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

function isShanghaiToday(date: Date, now = new Date()) {
  const current = shanghaiDateParts(now)
  const target = shanghaiDateParts(date)
  return current.year === target.year && current.month === target.month && current.day === target.day
}

export async function cleanupOldAppLogs(now = new Date()) {
  return prisma.appLog.deleteMany({ where: { timestamp: { lt: startOfShanghaiTodayUtc(now) } } })
}

export async function queryLogs(filters: LogFilters) {
  const page = pageValue(filters.page, 1, 100000)
  const pageSize = pageValue(filters.pageSize, 20, 100)
  const keyword = filters.keyword?.trim()
  const serviceFilter = filters.service?.startsWith('container:') ? { contains: filters.service, mode: 'insensitive' as const } : filters.service
  const sourceFilter: Prisma.AppLogWhereInput['source'] = filters.source === 'file'
    ? { notIn: ['docker', 'eventlog:Application', 'eventlog:System', 'smoke'] }
    : filters.source
  const where: Prisma.AppLogWhereInput = {
    service: serviceFilter,
    level: filters.level,
    hostId: filters.hostId,
    source: sourceFilter,
    timestamp: {
      gte: filters.startTime ? new Date(filters.startTime) : startOfShanghaiTodayUtc(),
      lte: filters.endTime ? new Date(filters.endTime) : undefined,
    },
    OR: keyword ? [{ traceId: { contains: keyword, mode: 'insensitive' } }, { message: { contains: keyword, mode: 'insensitive' } }, { service: { contains: keyword, mode: 'insensitive' } }] : undefined,
  }

  const [total, data] = await prisma.$transaction([
    prisma.appLog.count({ where }),
    prisma.appLog.findMany({ where, orderBy: { timestamp: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
  ])

  return { data: data.map(toLog), total, page, pageSize }
}

export async function getLogServices() {
  const [logRows, containers] = await Promise.all([
    prisma.appLog.groupBy({ by: ['service'], orderBy: { service: 'asc' } }),
    prisma.hostContainer.findMany({ where: { isCurrent: true }, select: { name: true }, orderBy: { name: 'asc' } }),
  ])
  const values = new Set(logRows.map((row) => row.service))
  for (const container of containers) values.add(`container:${container.name}`)
  return Array.from(values).sort((a, b) => a.localeCompare(b))
}

function shouldStoreLog(log: AgentLogInput) {
  const source = log.source ?? 'agent'
  if (source.startsWith('eventlog:')) return ['ERROR', 'WARN', 'INFO', 'DEBUG'].includes(log.level)
  if (source === '/var/log/syslog' || source === '/var/log/messages') return log.level === 'ERROR'
  return ['ERROR', 'WARN', 'INFO'].includes(log.level)
}

export async function ingestAgentLogs(hostId: string, logs: AgentLogInput[]) {
  const rows = logs.filter(shouldStoreLog).map((log, index) => {
    const timestamp = log.timestamp ? new Date(log.timestamp) : new Date()
    return {
      id: logId(hostId, index),
      time: timeText(timestamp),
      timestamp,
      service: log.service,
      level: log.level,
      traceId: traceId(hostId, index, log.traceId),
      message: compactMessage(log.message),
      hostId,
      source: log.source ?? 'agent',
      labels: log.labels as Prisma.InputJsonValue | undefined,
      rawPayload: log.rawPayload as Prisma.InputJsonValue | undefined,
    }
  })
  const todayRows = rows.filter((row) => isShanghaiToday(row.timestamp))
  const traceIds = todayRows.map((row) => row.traceId)
  const existing = traceIds.length ? await prisma.appLog.findMany({ where: { hostId, traceId: { in: traceIds } }, select: { traceId: true } }) : []
  const existingTraceIds = new Set(existing.map((row) => row.traceId))
  const pendingRows = todayRows.filter((row) => !existingTraceIds.has(row.traceId))
  if (pendingRows.length) await prisma.appLog.createMany({ data: pendingRows })
  return pendingRows.length
}
