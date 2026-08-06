import { prisma } from '../db/prisma'
import type { CreateAlertInput } from '../types/alert'

export interface AlertHostTarget {
  id: string
  ip: string
  hostname: string
  tags: string[]
  group?: string
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function addString(values: Set<string>, value: unknown) {
  if (typeof value === 'string' && value.trim()) values.add(value.trim())
}

function addStrings(values: Set<string>, value: unknown) {
  if (!Array.isArray(value)) return
  for (const item of value) addString(values, item)
}

export function alertMetadataHostIds(metadataValue: unknown) {
  const metadata = recordValue(metadataValue)
  const persistedIds = new Set<string>()
  addStrings(persistedIds, metadata.alertHostIds)
  if (persistedIds.size) return Array.from(persistedIds)

  const matchedIds = new Set<string>()
  addStrings(matchedIds, metadata.matchedHostIds)
  if (matchedIds.size) return Array.from(matchedIds)

  const directIds = new Set<string>()
  addString(directIds, metadata.sourceHostId)
  addString(directIds, metadata.hostId)
  addString(directIds, metadata.probeHostId)
  if (directIds.size) return Array.from(directIds)

  const scopedIds = new Set<string>()
  addStrings(scopedIds, metadata.hostIds)
  return Array.from(scopedIds)
}

async function relatedHostIds(input: Pick<CreateAlertInput, 'relatedType' | 'relatedId'>) {
  if (!input.relatedType || !input.relatedId) return []
  if (input.relatedType === 'host') return [input.relatedId]
  if (input.relatedType === 'host_service') {
    const row = await prisma.hostService.findUnique({ where: { id: input.relatedId }, select: { hostId: true } })
    return row ? [row.hostId] : []
  }
  if (input.relatedType === 'host_container') {
    const row = await prisma.hostContainer.findUnique({ where: { id: input.relatedId }, select: { hostId: true } })
    return row ? [row.hostId] : []
  }
  if (input.relatedType === 'service_event') {
    const row = await prisma.serviceEvent.findUnique({ where: { id: input.relatedId }, select: { hostId: true } })
    return row ? [row.hostId] : []
  }
  if (input.relatedType === 'log_monitor_rule') {
    const row = await prisma.logMonitorRule.findUnique({ where: { id: input.relatedId }, select: { hostId: true, hostIds: true } })
    return row ? [row.hostId, ...row.hostIds].filter((id): id is string => Boolean(id)) : []
  }
  if (input.relatedType === 'host_resource_monitor_rule') {
    const row = await prisma.hostResourceMonitorRule.findUnique({ where: { id: input.relatedId }, select: { hostId: true, hostIds: true } })
    return row ? [row.hostId, ...row.hostIds].filter((id): id is string => Boolean(id)) : []
  }
  if (input.relatedType === 'cgi_monitor_rule') {
    const row = await prisma.cgiMonitorRule.findUnique({ where: { id: input.relatedId }, select: { probeHostId: true } })
    return row?.probeHostId ? [row.probeHostId] : []
  }
  if (input.relatedType === 'ipush_monitor_rule') {
    const row = await prisma.ipushMonitorRule.findUnique({ where: { id: input.relatedId }, select: { hostId: true } })
    return row?.hostId ? [row.hostId] : []
  }
  return []
}

export async function resolveAlertHostTargets(input: Pick<CreateAlertInput, 'metadata' | 'relatedType' | 'relatedId'>): Promise<AlertHostTarget[]> {
  const metadata = recordValue(input.metadata)
  const hostIds = new Set(alertMetadataHostIds(metadata))
  if (!hostIds.size) {
    for (const id of await relatedHostIds(input)) hostIds.add(id)
  }

  const hostIps = new Set<string>()
  addString(hostIps, metadata.hostIp)
  addString(hostIps, metadata.ip)
  addString(hostIps, metadata.probeHostIp)
  if (!hostIds.size && !hostIps.size) return []

  const hosts = await prisma.host.findMany({
    where: {
      OR: [
        ...(hostIds.size ? [{ id: { in: Array.from(hostIds) } }] : []),
        ...(hostIps.size ? [{ ip: { in: Array.from(hostIps) } }] : []),
      ],
    },
    select: { id: true, ip: true, hostname: true, tags: true, group: true },
  })
  const order = new Map(Array.from(hostIds).map((id, index) => [id, index]))
  return hosts
    .sort((left, right) => (order.get(left.id) ?? Number.MAX_SAFE_INTEGER) - (order.get(right.id) ?? Number.MAX_SAFE_INTEGER))
    .map((host) => ({ ...host, tags: host.tags.filter(Boolean), group: host.group || undefined }))
}

export function formatAlertHost(target: Pick<AlertHostTarget, 'ip' | 'hostname' | 'tags'>) {
  const tags = target.tags.map((tag) => tag.trim()).filter(Boolean)
  return `${tags.length ? tags.join('、') : '无标签'}--${target.ip || '未知IP'}--${target.hostname || target.ip || '未知主机'}`
}

export function formatAlertHostPrefix(targets: AlertHostTarget[]) {
  const visible = targets.slice(0, 3).map(formatAlertHost)
  if (targets.length > visible.length) visible.push(`另${targets.length - visible.length}台主机`)
  return visible.join('、')
}

export function prefixAlertContent(contentValue: string, targets: AlertHostTarget[]) {
  const content = contentValue.trim()
  const prefix = formatAlertHostPrefix(targets)
  if (!prefix || content.startsWith(`${prefix}；`) || content.startsWith(`${prefix};`)) return content
  return `${prefix}；${content}`
}
