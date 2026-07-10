import { buildHostAuditHashChain } from '../utils/audit'
import { prisma } from '../db/prisma'
import type { HostAuditLog } from '../types/host'

type AuditLogSource = 'system' | 'host'
type ExportFormat = 'csv' | 'json'
type HashChainStatus = 'valid' | 'invalid' | 'not_applicable'

type GenericAuditRow = NonNullable<Awaited<ReturnType<typeof prisma.auditLog.findFirst>>>
type HostAuditRow = NonNullable<Awaited<ReturnType<typeof prisma.hostAuditLog.findFirst>>>

export interface AuditLogFilters {
  startTime?: Date
  endTime?: Date
  operator?: string
  actionType?: string
  resourceType?: string
  clientIp?: string
}

export interface AuditLogQuery extends AuditLogFilters {
  page: number
  pageSize: number
}

export interface UnifiedAuditLog {
  id: string
  source: AuditLogSource
  time: string
  timestamp: number
  operator: string
  actionType: string
  resourceType: string
  resourceId: string
  content: string
  requestSummary: string
  clientIp: string
  hashChainStatus: HashChainStatus
}

export interface AuditLogDetail extends UnifiedAuditLog {
  result: string
  requestBody: unknown
  responseBody: unknown
  raw: Record<string, unknown>
  hashVerification: { status: HashChainStatus; message: string }
}

export interface AuditExportTask {
  id: string
  status: 'processing' | 'completed'
  format: ExportFormat
  fileName: string
  downloadUrl: string
  createdAt: string
  completedAt?: string
  content?: string
}

const exportTasks = new Map<string, AuditExportTask>()

function formatDate(date: Date) {
  return date.toLocaleString('zh-CN', { hour12: false })
}

function parseHostTime(value: string) {
  const normalized = value.includes('/') ? value : value.replace(/-/g, '/')
  const time = new Date(normalized).getTime()
  return Number.isNaN(time) ? 0 : time
}

function parseJson(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return undefined
  }
}

function inferResourceType(action: string, target: string, source: AuditLogSource) {
  if (source === 'host') return '主机'
  if (action.includes('账号') || action.includes('密码')) return '账号'
  if (action.includes('自愈')) return '自愈规则'
  if (action.includes('初始化')) return '系统'
  return target || '系统'
}

function getGenericRequestSummary(log: GenericAuditRow) {
  const parsed = parseJson(log.detail)
  if (parsed && typeof parsed === 'object') {
    const summary = (parsed as Record<string, unknown>).summary ?? (parsed as Record<string, unknown>).requestSummary
    if (typeof summary === 'string') return summary
  }
  return log.detail
}

function toGenericLog(log: GenericAuditRow): UnifiedAuditLog {
  return {
    id: log.id,
    source: 'system',
    time: formatDate(log.time),
    timestamp: log.time.getTime(),
    operator: log.operator,
    actionType: log.action,
    resourceType: inferResourceType(log.action, log.target, 'system'),
    resourceId: log.target,
    content: log.detail,
    requestSummary: getGenericRequestSummary(log),
    clientIp: '-',
    hashChainStatus: 'not_applicable',
  }
}

function verifyHostHash(log: HostAuditRow, index: number, rows: HostAuditRow[]) {
  const chainInput = rows.map(({ previousHash: _previousHash, hash: _hash, createdAt: _createdAt, ...item }) => ({
    ...item,
    result: item.result as '成功' | '失败',
  }))
  const expected = buildHostAuditHashChain(chainInput as Omit<HostAuditLog, 'previousHash' | 'hash'>[])
  return expected[index]?.previousHash === log.previousHash && expected[index]?.hash === log.hash
}

function toHostLog(log: HostAuditRow, hashChainStatus: HashChainStatus): UnifiedAuditLog {
  return {
    id: log.id,
    source: 'host',
    time: log.time,
    timestamp: parseHostTime(log.time) || log.createdAt.getTime(),
    operator: log.operator,
    actionType: log.action,
    resourceType: '主机',
    resourceId: log.target,
    content: log.detail,
    requestSummary: log.detail,
    clientIp: '-',
    hashChainStatus,
  }
}

function matchesText(value: string, keyword?: string) {
  if (!keyword?.trim()) return true
  return value.toLowerCase().includes(keyword.trim().toLowerCase())
}

function matchesFilters(log: UnifiedAuditLog, filters: AuditLogFilters) {
  if (filters.startTime && log.timestamp < filters.startTime.getTime()) return false
  if (filters.endTime && log.timestamp > filters.endTime.getTime()) return false
  if (!matchesText(log.operator, filters.operator)) return false
  if (filters.actionType && log.actionType !== filters.actionType) return false
  if (filters.resourceType && log.resourceType !== filters.resourceType) return false
  if (!matchesText(log.clientIp, filters.clientIp)) return false
  return true
}

async function getAllAuditLogs() {
  const [genericRows, hostRows] = await Promise.all([
    prisma.auditLog.findMany({ orderBy: { time: 'desc' } }),
    prisma.hostAuditLog.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
  ])
  const hostLogs = hostRows.map((log, index) => toHostLog(log, verifyHostHash(log, index, hostRows) ? 'valid' : 'invalid'))
  return [...genericRows.map(toGenericLog), ...hostLogs].sort((left, right) => right.timestamp - left.timestamp)
}

export async function queryAuditLogs(query: AuditLogQuery) {
  const page = Math.max(1, query.page)
  const pageSize = Math.min(100, Math.max(1, query.pageSize))
  const filtered = (await getAllAuditLogs()).filter((log) => matchesFilters(log, query))
  const start = (page - 1) * pageSize
  return {
    data: filtered.slice(start, start + pageSize),
    total: filtered.length,
    page,
    pageSize,
  }
}

export async function getAuditLogOptions() {
  const logs = await getAllAuditLogs()
  return {
    actionTypes: Array.from(new Set(logs.map((log) => log.actionType))).sort(),
    resourceTypes: Array.from(new Set(logs.map((log) => log.resourceType))).sort(),
  }
}

export async function getAuditLogDetail(id: string): Promise<AuditLogDetail | undefined> {
  const generic = await prisma.auditLog.findUnique({ where: { id } })
  if (generic) {
    const parsed = parseJson(generic.detail)
    const requestBody = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).request ?? parsed : generic.detail
    const responseBody = parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>).response ?? { result: generic.result } : { result: generic.result }
    return {
      ...toGenericLog(generic),
      result: generic.result,
      requestBody,
      responseBody,
      raw: { ...generic },
      hashVerification: { status: 'not_applicable', message: '通用审计日志未启用 hash 链' },
    }
  }

  const hostRows = await prisma.hostAuditLog.findMany({ orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] })
  const index = hostRows.findIndex((log) => log.id === id)
  const host = hostRows[index]
  if (!host) return undefined
  const valid = verifyHostHash(host, index, hostRows)
  return {
    ...toHostLog(host, valid ? 'valid' : 'invalid'),
    result: host.result,
    requestBody: { action: host.action, target: host.target, detail: host.detail },
    responseBody: { result: host.result, retentionUntil: host.retentionUntil },
    raw: { ...host },
    hashVerification: { status: valid ? 'valid' : 'invalid', message: valid ? 'hash 链验证通过' : 'hash 链验证失败，日志可能被篡改' },
  }
}

function escapeCsvValue(value: unknown) {
  const text = String(value ?? '')
  if (!/[",\n]/.test(text)) return text
  return `"${text.replace(/"/g, '""')}"`
}

function exportCsv(logs: UnifiedAuditLog[]) {
  const headers = ['id', 'time', 'operator', 'actionType', 'resourceType', 'resourceId', 'content', 'requestSummary', 'clientIp', 'hashChainStatus']
  return [headers.join(','), ...logs.map((log) => headers.map((key) => escapeCsvValue(log[key as keyof UnifiedAuditLog])).join(','))].join('\n')
}

export async function createAuditLogExportTask(format: ExportFormat, filters: AuditLogFilters) {
  const logs = (await getAllAuditLogs()).filter((log) => matchesFilters(log, filters))
  const id = `audit-export-${Date.now().toString(36)}`
  const fileName = `audit-logs-${new Date().toISOString().slice(0, 10)}.${format}`
  const content = format === 'json' ? JSON.stringify(logs, null, 2) : exportCsv(logs)
  const task: AuditExportTask = {
    id,
    status: 'completed',
    format,
    fileName,
    downloadUrl: `/api/audit/logs/export/${id}/download`,
    createdAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    content,
  }
  exportTasks.set(id, task)
  return task
}

export function getAuditExportTask(id: string) {
  return exportTasks.get(id)
}
