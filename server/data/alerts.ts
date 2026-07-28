import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import type { AlertFilters, AlertItem, AlertPage, AlertSummary, CreateAlertInput } from '../types/alert'
import { ingestAlert, toAlertItem } from '../services/alertIngestionService'
import { getNoiseReductionStats, listSuppressedAlerts, suppressFingerprint, unsuppressFingerprint } from '../services/alertNoiseReductionService'
import { emitAlertEvent } from '../services/realtime'
import { shanghaiTime, startOfShanghaiDayUtc } from '../utils/time'

const levels: AlertItem['level'][] = ['紧急', '严重', '警告', '提示']
const statuses: AlertItem['status'][] = ['待处理', '处理中', '已解决']

const defaultDiagnosis = (alert: AlertItem) => `AI 诊断结果：${alert.service} 的「${alert.title || alert.content}」建议优先检查最近发布、上游依赖健康度和资源水位。建议操作：1）查看服务日志关键错误；2）比对近 30 分钟 QPS 与错误率；3）必要时执行回滚或扩容。`

function nowText() {
  return shanghaiTime(new Date())
}

function startOfToday() {
  return startOfShanghaiDayUtc(new Date())
}

function boolFilter(value: boolean | undefined) {
  return typeof value === 'boolean' ? value : undefined
}

async function appendAudit(operator: string, action: string, target: string, detail: string) {
  await prisma.auditLog.create({ data: { operator, action, target, result: '成功', detail } })
}

function queryWhere(filters: AlertFilters): Prisma.AlertWhereInput {
  const keyword = filters.keyword?.trim()
  const createdAt: Prisma.DateTimeFilter = {}
  if (filters.startTime) createdAt.gte = new Date(filters.startTime)
  if (filters.endTime) createdAt.lte = new Date(filters.endTime)
  const hasCreatedAt = Boolean(createdAt.gte || createdAt.lte)

  return {
    level: filters.level,
    status: filters.status ?? (filters.active ? { not: '已解决' } : undefined),
    service: filters.service,
    source: filters.source,
    isSuppressed: boolFilter(filters.isSuppressed) ?? (filters.includeSuppressed ? undefined : false),
    createdAt: hasCreatedAt ? createdAt : undefined,
    OR: keyword
      ? [
        { id: { contains: keyword, mode: 'insensitive' } },
        { service: { contains: keyword, mode: 'insensitive' } },
        { source: { contains: keyword, mode: 'insensitive' } },
        { title: { contains: keyword, mode: 'insensitive' } },
        { content: { contains: keyword, mode: 'insensitive' } },
        { owner: { contains: keyword, mode: 'insensitive' } },
      ]
      : undefined,
  }
}

function metadataObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function pushHostId(ids: Set<string>, value: unknown) {
  if (typeof value === 'string' && value.trim()) ids.add(value.trim())
}

function hostIdsFromAlert(alert: { metadata: unknown; relatedType?: string | null; relatedId?: string | null }) {
  const ids = new Set<string>()
  const metadata = metadataObject(alert.metadata)
  pushHostId(ids, metadata.hostId)
  pushHostId(ids, metadata.sourceHostId)
  pushHostId(ids, metadata.probeHostId)
  if (Array.isArray(metadata.hostIds)) {
    for (const hostId of metadata.hostIds) pushHostId(ids, hostId)
  }
  if (alert.relatedType === 'host') pushHostId(ids, alert.relatedId)
  return Array.from(ids)
}

async function enrichAlertHosts(alerts: Awaited<ReturnType<typeof prisma.alert.findMany>>) {
  const alertItems = alerts.map(toAlertItem)
  const hostIds = Array.from(new Set(alerts.flatMap(hostIdsFromAlert)))
  if (!hostIds.length) return alertItems

  const hosts = await prisma.host.findMany({
    where: { id: { in: hostIds } },
    select: { id: true, ip: true, hostname: true, tags: true, group: true },
  })
  const hostById = new Map(hosts.map((host) => [host.id, host]))
  return alertItems.map((item, index) => {
    const targets = hostIdsFromAlert(alerts[index])
      .map((hostId) => hostById.get(hostId))
      .filter((host): host is NonNullable<typeof host> => Boolean(host))
    if (!targets.length) return item
    return {
      ...item,
      hostTargets: targets.map((host) => ({
        id: host.id,
        ip: host.ip,
        hostname: host.hostname,
        tags: Array.isArray(host.tags) ? host.tags : [],
        group: host.group || undefined,
      })),
    }
  })
}

export async function queryAlerts(filters: AlertFilters): Promise<AlertPage> {
  const page = Math.max(1, filters.page ?? 1)
  const pageSize = Math.min(100, Math.max(1, filters.pageSize ?? 20))
  const where = queryWhere(filters)
  const [total, alerts] = await Promise.all([
    prisma.alert.count({ where }),
    prisma.alert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ])
  return { data: await enrichAlertHosts(alerts), page, pageSize, total }
}

export async function getAlert(id: string) {
  const alert = await prisma.alert.findUnique({ where: { id } })
  return alert ? (await enrichAlertHosts([alert]))[0] : undefined
}

export async function createAlert(input: CreateAlertInput, operator: string) {
  const result = await ingestAlert({ owner: operator, ...input })
  if (result.alert) await appendAudit(operator, '创建告警', result.alert.id, `${result.alert.service}：${result.alert.title || result.alert.content}`)
  return result
}

export async function getAlertSummary(): Promise<AlertSummary> {
  const [total, active, today, suppressed, resolved, byLevelRows, byStatusRows] = await Promise.all([
    prisma.alert.count(),
    prisma.alert.count({ where: { status: { not: '已解决' }, isSuppressed: false } }),
    prisma.alert.count({ where: { createdAt: { gte: startOfToday() }, isSuppressed: false } }),
    prisma.alert.count({ where: { isSuppressed: true } }),
    prisma.alert.count({ where: { status: '已解决' } }),
    prisma.alert.groupBy({ by: ['level'], where: { isSuppressed: false }, _count: { _all: true } }),
    prisma.alert.groupBy({ by: ['status'], where: { isSuppressed: false }, _count: { _all: true } }),
  ])

  return {
    total,
    active,
    today,
    suppressed,
    resolved,
    byLevel: Object.fromEntries(levels.map((level) => [level, byLevelRows.find((row) => row.level === level)?._count._all ?? 0])) as AlertSummary['byLevel'],
    byStatus: Object.fromEntries(statuses.map((status) => [status, byStatusRows.find((row) => row.status === status)?._count._all ?? 0])) as AlertSummary['byStatus'],
  }
}

export async function acknowledgeAlert(id: string, operator: string) {
  const current = await getAlert(id)
  if (!current) return undefined
  const updated = await prisma.alert.update({ where: { id }, data: { status: current.status === '已解决' ? '已解决' : '处理中', acknowledgedAt: nowText(), owner: operator } })
  await appendAudit(operator, '确认告警', updated.id, `${updated.service}：${updated.title || updated.content}`)
  const item = toAlertItem(updated)
  emitAlertEvent('alert:updated', item)
  return item
}

export async function resolveAlert(id: string, operator: string) {
  const current = await getAlert(id)
  if (!current) return undefined
  const updated = await prisma.alert.update({ where: { id }, data: { status: '已解决', resolvedAt: nowText(), owner: operator } })
  await appendAudit(operator, '解决告警', updated.id, `${updated.service}：${updated.title || updated.content}`)
  const item = toAlertItem(updated)
  emitAlertEvent('alert:resolved', item)
  return item
}

export async function diagnoseAlert(id: string, operator: string) {
  const current = await getAlert(id)
  if (!current) return undefined
  const result = defaultDiagnosis(current)
  const updated = await prisma.alert.update({ where: { id }, data: { diagnosis: result } })
  await appendAudit(operator, '诊断告警', updated.id, `${updated.service}：${updated.title || updated.content}`)
  return { alertId: id, result }
}

export { getNoiseReductionStats, listSuppressedAlerts, suppressFingerprint, unsuppressFingerprint }
