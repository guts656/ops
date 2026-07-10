import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma.ts'
import { resolveAlert } from './alerts.ts'
import { ingestAlert } from '../services/alertIngestionService.ts'
import type { AlertLevel } from '../types/alert'
import type { AgentServiceEventInput, AgentServiceInput, HostServiceItem, ServiceEventItem } from '../types/service'
import { shanghaiTime } from '../utils/time'

type HostServiceRow = NonNullable<Awaited<ReturnType<typeof prisma.hostService.findFirst>>>
type ServiceEventRow = NonNullable<Awaited<ReturnType<typeof prisma.serviceEvent.findFirst>>>
type HostSummary = { id: string; ip: string; hostname: string; owner: string }

const healthyStatuses = new Set(['running', 'active'])
const stoppedBaselineStatuses = new Set(['stopped', 'inactive', 'not_running', 'exited'])
const severeStatuses = new Set(['failed', 'error', 'dead', 'missing', 'removed', '异常'])
const abnormalStatuses = new Set([...severeStatuses, ...stoppedBaselineStatuses, 'unknown'])

function displayTime(date: Date) {
  return shanghaiTime(date)
}

function normalizedStatus(status: string | null | undefined) {
  return String(status || '').trim().toLowerCase()
}

function isHealthyStatus(status: string | null | undefined) {
  return healthyStatuses.has(normalizedStatus(status))
}

function isAbnormalStatus(status: string | null | undefined) {
  return abnormalStatuses.has(normalizedStatus(status))
}

function isStoppedBaselineStatus(status: string | null | undefined) {
  return stoppedBaselineStatuses.has(normalizedStatus(status))
}

function alertLevelForStatus(status: string): AlertLevel {
  const normalized = normalizedStatus(status)
  return severeStatuses.has(normalized) || stoppedBaselineStatuses.has(normalized) ? '严重' : '警告'
}

function eventTypeForStatus(status: string) {
  const normalized = normalizedStatus(status)
  if (normalized === 'missing' || normalized === 'removed') return 'service_missing'
  if (normalized === 'failed' || normalized === 'error' || normalized === 'dead') return 'service_failed'
  if (normalized === 'stopped' || normalized === 'inactive' || normalized === 'not_running') return 'service_not_running'
  return 'service_status_changed'
}

function serviceKey(value: { name: string; port?: number | null }) {
  return `${value.name}::${value.port ?? 0}`
}

function toHostService(row: HostServiceRow): HostServiceItem {
  return {
    id: row.id,
    hostId: row.hostId,
    name: row.name,
    status: row.status,
    port: row.port ?? undefined,
    protocol: row.protocol ?? undefined,
    version: row.version ?? undefined,
    pid: row.pid ?? undefined,
    source: row.source,
    metadata: row.metadata ?? undefined,
    lastReportedAt: displayTime(row.lastReportedAt),
  }
}

function toServiceEvent(row: ServiceEventRow): ServiceEventItem {
  return {
    id: row.id,
    hostId: row.hostId,
    service: row.service,
    eventType: row.eventType,
    level: row.level,
    message: row.message,
    occurredAt: displayTime(row.occurredAt),
    source: row.source,
    payload: row.payload ?? undefined,
  }
}

export async function getHostServices(hostId: string) {
  if (await isLinuxHost(hostId)) return []
  const services = await prisma.hostService.findMany({ where: { hostId, NOT: { metadata: { path: ['hiddenStoppedBaseline'], equals: true } } }, orderBy: [{ status: 'asc' }, { name: 'asc' }] })
  return services.map(toHostService)
}

export async function getHostServiceEvents(hostId: string, limit = 50) {
  if (await isLinuxHost(hostId)) return []
  const events = await prisma.serviceEvent.findMany({ where: { hostId }, orderBy: { occurredAt: 'desc' }, take: Math.min(100, Math.max(1, limit)) })
  return events.map(toServiceEvent)
}

function isLinuxOs(os: string | null | undefined) {
  return String(os || '').toLowerCase().includes('linux')
}

async function isLinuxHost(hostId: string) {
  const host = await prisma.host.findUnique({ where: { id: hostId }, select: { os: true } })
  return isLinuxOs(host?.os)
}

function isWindowsSystemService(service: AgentServiceInput) {
  if (service.source !== 'windows-service') return false
  const path = String((service.metadata as { path?: unknown } | undefined)?.path ?? '').toLowerCase().replaceAll('/', '\\')
  return !path || path === 'c:\\window' || path.startsWith('c:\\windows') || path.includes('\\windows\\') || path.startsWith('\\systemroot\\') || path.startsWith('%systemroot%\\') || path.startsWith('c:\\program files\\windows defender\\') || path.startsWith('c:\\program files (x86)\\windows defender\\')
}

function metadataObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function isHiddenStoppedBaseline(service: Pick<HostServiceRow, 'metadata'>) {
  return metadataObject(service.metadata).hiddenStoppedBaseline === true
}

function hasEverBeenHealthy(service: Pick<HostServiceRow, 'metadata' | 'status'>) {
  return metadataObject(service.metadata).everHealthy === true || isHealthyStatus(service.status)
}

function shouldHideWindowsStoppedService(service: AgentServiceInput, previous?: HostServiceRow) {
  if (service.source !== 'windows-service' || !isStoppedBaselineStatus(service.status)) return false
  if (!previous) return true
  return !hasEverBeenHealthy(previous)
}

function serviceAlertFingerprint(hostId: string, serviceName: string, port?: number | null) {
  return `agent-service:${hostId}:${serviceName}:${port ?? 0}:abnormal`
}

export async function cleanupLinuxServiceMonitoring(hostId?: string) {
  const linuxHosts = await prisma.host.findMany({ where: { id: hostId, os: { contains: 'Linux', mode: 'insensitive' } }, select: { id: true } })
  const hostIds = linuxHosts.map((host) => host.id)
  if (!hostIds.length) return { hosts: 0, services: 0, events: 0, alertsResolved: 0 }

  const [services, events] = await Promise.all([
    prisma.hostService.findMany({ where: { hostId: { in: hostIds } }, select: { id: true } }),
    prisma.serviceEvent.findMany({ where: { hostId: { in: hostIds } }, select: { id: true } }),
  ])
  const serviceIds = services.map((service) => service.id)
  const eventIds = events.map((event) => event.id)
  const alertConditions: Prisma.AlertWhereInput[] = [
    ...serviceIds.length ? [{ relatedType: 'host_service', relatedId: { in: serviceIds } }] : [],
    ...eventIds.length ? [{ relatedType: 'service_event', relatedId: { in: eventIds } }] : [],
    ...hostIds.map((id) => ({ fingerprint: { startsWith: `agent-service:${id}:` } })),
  ]
  const staleAlerts = alertConditions.length ? await prisma.alert.findMany({
    where: {
      source: 'Agent服务监控',
      status: { not: '已解决' },
      OR: alertConditions,
    },
    select: { id: true },
  }) : []
  const now = displayTime(new Date())
  if (staleAlerts.length) {
    await prisma.alert.updateMany({
      where: { id: { in: staleAlerts.map((alert) => alert.id) } },
      data: { status: '已解决', resolvedAt: now, owner: '系统清理' },
    })
  }
  const deletedEvents = await prisma.serviceEvent.deleteMany({ where: { hostId: { in: hostIds } } })
  const deletedServices = await prisma.hostService.deleteMany({ where: { hostId: { in: hostIds } } })
  return { hosts: hostIds.length, services: deletedServices.count, events: deletedEvents.count, alertsResolved: staleAlerts.length }
}

async function createServiceAlert(host: HostSummary, service: HostServiceRow, event: ServiceEventRow, previousStatus: string | undefined, currentStatus: string) {
  if (!isAbnormalStatus(currentStatus)) return
  const level = alertLevelForStatus(currentStatus)
  const hostLabel = `${host.ip} · ${host.hostname}`
  await ingestAlert({
    source: 'Agent服务监控',
    level,
    service: service.name,
    title: `主机服务异常：${service.name}`,
    content: `主机 ${hostLabel} 上的服务 ${service.name} 状态异常：${previousStatus || '-'} -> ${currentStatus}。事件：${event.message}`,
    owner: host.owner || 'Agent服务监控',
    relatedType: 'host_service',
    relatedId: service.id,
    fingerprint: serviceAlertFingerprint(host.id, service.name, service.port),
    metadata: {
      hostId: host.id,
      hostIp: host.ip,
      hostname: host.hostname,
      service: service.name,
      previousStatus,
      currentStatus,
      eventType: event.eventType,
      source: event.source,
      serviceEventId: event.id,
    },
  })
}

async function resolveServiceAlert(host: HostSummary, service: HostServiceRow, event: ServiceEventRow, previousStatus: string | undefined, currentStatus: string) {
  const alert = await prisma.alert.findFirst({ where: { fingerprint: serviceAlertFingerprint(host.id, service.name, service.port) }, orderBy: { updatedAt: 'desc' } })
  if (!alert) return
  const metadata = alert.metadata && typeof alert.metadata === 'object' && !Array.isArray(alert.metadata) ? alert.metadata as Record<string, unknown> : {}
  await prisma.alert.update({
    where: { id: alert.id },
    data: {
      metadata: {
        ...metadata,
        recoveredAfterResolve: true,
        recovery: { hostId: host.id, hostIp: host.ip, hostname: host.hostname, service: service.name, previousStatus, currentStatus, eventType: event.eventType, serviceEventId: event.id, recoveredAt: new Date().toISOString() },
      } as Prisma.InputJsonValue,
    },
  })
  if (alert.status !== '已解决') await resolveAlert(alert.id, 'Agent服务监控')
}

async function createTransitionEvent(host: HostSummary, service: HostServiceRow, previousStatus: string | undefined, currentStatus: string, options: { source?: string; message?: string; payload?: Record<string, unknown> } = {}) {
  const recovered = isHealthyStatus(currentStatus)
  const eventType = recovered ? 'service_recovered' : eventTypeForStatus(currentStatus)
  const level = recovered ? 'INFO' : alertLevelForStatus(currentStatus) === '严重' ? 'ERROR' : 'WARN'
  const message = options.message || (isHealthyStatus(currentStatus)
    ? `${service.name} recovered: ${previousStatus || '-'} -> ${currentStatus}`
    : `${service.name} abnormal: ${previousStatus || '-'} -> ${currentStatus}`)
  const event = await prisma.serviceEvent.create({
    data: {
      hostId: host.id,
      service: service.name,
      eventType,
      level,
      message,
      occurredAt: new Date(),
      source: options.source || service.source || 'agent',
      payload: { previousStatus, currentStatus, serviceId: service.id, ...(options.payload ?? {}) } as Prisma.InputJsonValue,
    },
  })
  if (recovered) await resolveServiceAlert(host, service, event, previousStatus, currentStatus)
  else await createServiceAlert(host, service, event, previousStatus, currentStatus)
  return event
}

export async function ingestHostServices(hostId: string, services: AgentServiceInput[]) {
  const host = await prisma.host.findUnique({ where: { id: hostId }, select: { id: true, ip: true, hostname: true, owner: true, os: true } })
  if (!host) throw new Error('主机不存在')
  if (isLinuxOs(host.os)) {
    await cleanupLinuxServiceMonitoring(hostId)
    return 0
  }
  const filteredServices = services.filter((service) => !isWindowsSystemService(service))
  const now = new Date()
  const existing = await prisma.hostService.findMany({ where: { hostId } })
  const existingByKey = new Map(existing.map((service) => [serviceKey(service), service]))
  const reportedKeys = new Set<string>()

  for (const service of filteredServices) {
    const port = service.port ?? 0
    const key = serviceKey({ name: service.name, port })
    reportedKeys.add(key)
    const previous = existingByKey.get(key)
    const previousMetadata = metadataObject(previous?.metadata)
    const previousHiddenBaseline = previous ? isHiddenStoppedBaseline(previous) : false
    const everHealthy = Boolean(previousMetadata.everHealthy) || isHealthyStatus(previous?.status) || isHealthyStatus(service.status)
    const hiddenStoppedBaseline = shouldHideWindowsStoppedService(service, previous)
    const data = {
      status: service.status,
      protocol: service.protocol,
      version: service.version,
      pid: service.pid,
      source: service.source ?? 'agent',
      metadata: { ...metadataObject(service.metadata), hiddenStoppedBaseline, everHealthy } as Prisma.InputJsonValue,
      lastReportedAt: service.lastReportedAt ? new Date(service.lastReportedAt) : now,
    }
    const saved = await prisma.hostService.upsert({
      where: { hostId_name_port: { hostId, name: service.name, port } },
      create: { hostId, name: service.name, port, ...data },
      update: data,
    })

    if (hiddenStoppedBaseline || previousHiddenBaseline || !previous) continue
    const previousStatus = normalizedStatus(previous.status)
    const currentStatus = normalizedStatus(saved.status)
    if (previousStatus === currentStatus) {
      if (isAbnormalStatus(currentStatus)) {
        const event = await prisma.serviceEvent.create({
          data: {
            hostId,
            service: saved.name,
            eventType: eventTypeForStatus(saved.status),
            level: alertLevelForStatus(saved.status) === '严重' ? 'ERROR' : 'WARN',
            message: `${saved.name} still abnormal: ${saved.status}`,
            occurredAt: now,
            source: saved.source || 'agent',
            payload: { repeated: true, reportedService: service as unknown as Record<string, unknown> } as Prisma.InputJsonValue,
          },
        })
        await createServiceAlert(host, saved, event, previous.status, saved.status)
      }
      continue
    }
    if (isAbnormalStatus(currentStatus) || (isAbnormalStatus(previousStatus) && isHealthyStatus(currentStatus))) {
      await createTransitionEvent(host, saved, previous.status, saved.status, { source: saved.source, payload: { reportedService: service as unknown as Record<string, unknown> } })
    }
  }

  for (const service of existing) {
    const key = serviceKey(service)
    const status = normalizedStatus(service.status)
    if (reportedKeys.has(key) || isHiddenStoppedBaseline(service) || status === 'missing' || status === 'removed') continue
    const saved = await prisma.hostService.update({ where: { id: service.id }, data: { status: 'missing', pid: null, lastReportedAt: now, metadata: { previousMetadata: service.metadata, missingDetectedAt: now.toISOString() } as Prisma.InputJsonValue } })
    await createTransitionEvent(host, saved, service.status, 'missing', { source: service.source, message: `${service.name} was not included in the latest agent service report`, payload: { reason: 'absent_from_latest_report' } })
  }

  return filteredServices.length
}

function eventStatus(event: AgentServiceEventInput) {
  const type = event.eventType.toLowerCase()
  if (type.includes('not_running') || type.includes('stop')) return 'stopped'
  if (type.includes('failed')) return 'failed'
  if (type.includes('recover') || type.includes('start') || type.includes('running')) return 'running'
  return event.level === 'ERROR' ? 'failed' : event.level === 'WARN' ? 'stopped' : 'unknown'
}

function eventLevelForStatus(status: string) {
  return alertLevelForStatus(status) === '严重' ? 'ERROR' : 'WARN'
}

async function createEventDerivedService(hostId: string, event: AgentServiceEventInput, currentStatus: string, occurredAt: Date) {
  return prisma.hostService.upsert({
    where: { hostId_name_port: { hostId, name: event.service, port: 0 } },
    create: {
      hostId,
      name: event.service,
      port: 0,
      status: currentStatus,
      source: event.source ?? 'agent',
      metadata: { detectedFromEvent: true, eventType: event.eventType, firstEventAt: occurredAt.toISOString() } as Prisma.InputJsonValue,
      lastReportedAt: occurredAt,
    },
    update: {
      status: currentStatus,
      source: event.source ?? 'agent',
      metadata: { detectedFromEvent: true, eventType: event.eventType, lastEventAt: occurredAt.toISOString() } as Prisma.InputJsonValue,
      lastReportedAt: occurredAt,
    },
  })
}

export async function ingestServiceEvents(hostId: string, events: AgentServiceEventInput[]) {
  if (!events.length) return 0
  const host = await prisma.host.findUnique({ where: { id: hostId }, select: { id: true, ip: true, hostname: true, owner: true, os: true } })
  if (!host) throw new Error('主机不存在')
  if (isLinuxOs(host.os)) {
    await cleanupLinuxServiceMonitoring(hostId)
    return 0
  }
  for (const event of events) {
    const occurredAt = event.occurredAt ? new Date(event.occurredAt) : new Date()
    const savedEvent = await prisma.serviceEvent.create({
      data: {
        hostId,
        service: event.service,
        eventType: event.eventType,
        level: event.level,
        message: event.message,
        occurredAt,
        source: event.source ?? 'agent',
        payload: event.payload as Prisma.InputJsonValue | undefined,
      },
    })
    const currentStatus = eventStatus(event)
    const service = await prisma.hostService.findFirst({ where: { hostId, name: event.service }, orderBy: { lastReportedAt: 'desc' } })
    if (isHealthyStatus(currentStatus)) {
      if (service) {
        const savedService = await prisma.hostService.update({
          where: { id: service.id },
          data: { status: currentStatus, lastReportedAt: occurredAt, metadata: { ...metadataObject(service.metadata), hiddenStoppedBaseline: false, everHealthy: true } as Prisma.InputJsonValue },
        })
        await resolveServiceAlert(host, savedService, savedEvent, service.status, currentStatus)
      }
      continue
    }
    if (event.level !== 'ERROR' && event.level !== 'WARN') continue
    if (service) {
      if (isHiddenStoppedBaseline(service) && isStoppedBaselineStatus(currentStatus)) continue
      await createServiceAlert(host, service, savedEvent, service.status, currentStatus)
      continue
    }
    const eventDerivedService = await createEventDerivedService(hostId, event, currentStatus, occurredAt)
    await createServiceAlert(host, eventDerivedService, savedEvent, undefined, currentStatus)
  }
  return events.length
}
