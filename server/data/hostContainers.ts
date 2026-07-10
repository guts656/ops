import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import type { AgentContainerInput, HostContainerItem } from '../types/container'
import { resolveAlert } from './alerts'
import { ingestAlert } from '../services/alertIngestionService'
import { shanghaiTime } from '../utils/time'

type HostContainerRow = NonNullable<Awaited<ReturnType<typeof prisma.hostContainer.findFirst>>>
type HostSummary = { id: string; ip: string; hostname: string; owner: string }

const abnormalContainerStates = new Set(['exited', 'dead', 'missing', 'removed', 'unknown'])
const healthyContainerStates = new Set(['running'])

function optionalBigInt(value: string | number | null | undefined) {
  if (value === undefined || value === null || value === '') return undefined
  return BigInt(value)
}

function optionalInt(value: number | null | undefined) {
  return value === null || value === undefined ? undefined : Math.round(value)
}

function optionalDate(value: string | null | undefined) {
  return value ? new Date(value) : undefined
}

function toItem(row: HostContainerRow): HostContainerItem {
  return {
    id: row.id,
    hostId: row.hostId,
    containerId: row.containerId,
    name: row.name,
    image: row.image,
    status: row.status,
    state: row.state,
    restartCount: row.restartCount,
    ports: row.ports ?? undefined,
    cpuPercent: row.cpuPercent ?? undefined,
    memoryUsageBytes: row.memoryUsageBytes?.toString(),
    memoryLimitBytes: row.memoryLimitBytes?.toString(),
    memoryPercent: row.memoryPercent ?? undefined,
    networkRxBytes: row.networkRxBytes?.toString(),
    networkTxBytes: row.networkTxBytes?.toString(),
    blockReadBytes: row.blockReadBytes?.toString(),
    blockWriteBytes: row.blockWriteBytes?.toString(),
    labels: row.labels ?? undefined,
    startedAt: row.startedAt ? shanghaiTime(row.startedAt) : undefined,
    lastReportedAt: shanghaiTime(row.lastReportedAt),
    isCurrent: row.isCurrent,
    logicalKey: row.logicalKey ?? undefined,
    retiredAt: row.retiredAt ? shanghaiTime(row.retiredAt) : undefined,
    retiredReason: row.retiredReason ?? undefined,
  }
}

function labelsOf(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function labelString(labels: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = labels[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizeContainerName(name: string) {
  const value = name.replace(/^\//, '')
  const swarmName = value.match(/^(.+)\.\d+\.[^.]+$/)
  if (swarmName) return swarmName[1]
  const replicaName = value.match(/^(.+?)[_-]\d+$/)
  return replicaName ? replicaName[1] : value
}

function containerLogicalKey(container: Pick<AgentContainerInput, 'name' | 'labels'>) {
  const labels = labelsOf(container.labels)
  const composeProject = labelString(labels, ['com.docker.compose.project'])
  const composeService = labelString(labels, ['com.docker.compose.service'])
  if (composeProject && composeService) return `compose:${composeProject}:${composeService}`
  if (composeService) return `compose:${composeService}`
  const swarmService = labelString(labels, ['com.docker.swarm.service.name'])
  if (swarmService) return `swarm:${swarmService}`
  const stack = labelString(labels, ['com.docker.stack.namespace'])
  if (stack && composeService) return `stack:${stack}:${composeService}`
  return `name:${normalizeContainerName(container.name)}`
}

function normalizedState(state: string | null | undefined) {
  return String(state || '').trim().toLowerCase()
}

function isActiveState(state: string) {
  return ['running', 'restarting', 'paused', 'created'].includes(normalizedState(state))
}

function isHealthyContainerState(state: string | null | undefined) {
  return healthyContainerStates.has(normalizedState(state))
}

function isAbnormalContainerState(state: string | null | undefined) {
  return abnormalContainerStates.has(normalizedState(state))
}

function containerAlertFingerprint(hostId: string, container: Pick<HostContainerRow, 'containerId' | 'logicalKey' | 'name'>) {
  return `agent-container:${hostId}:${container.logicalKey || container.containerId || normalizeContainerName(container.name)}:abnormal`
}

async function createContainerAlert(host: HostSummary, container: HostContainerRow, previousState: string | undefined, currentState: string) {
  if (!isAbnormalContainerState(currentState)) return
  const hostLabel = `${host.ip} · ${host.hostname}`
  await ingestAlert({
    source: 'Agent容器监控',
    level: currentState === 'dead' || currentState === 'missing' ? '严重' : '警告',
    service: `container:${container.name}`,
    title: `主机容器异常：${container.name}`,
    content: `主机 ${hostLabel} 上的容器 ${container.name} 状态异常：${previousState || '-'} -> ${currentState}。镜像：${container.image}`,
    owner: host.owner || 'Agent容器监控',
    relatedType: 'host_container',
    relatedId: container.id,
    fingerprint: containerAlertFingerprint(host.id, container),
    metadata: {
      hostId: host.id,
      hostIp: host.ip,
      hostname: host.hostname,
      containerId: container.containerId,
      containerName: container.name,
      image: container.image,
      logicalKey: container.logicalKey,
      previousState,
      currentState,
    },
  })
}

async function resolveContainerAlert(host: HostSummary, container: HostContainerRow, previousState: string | undefined, currentState: string) {
  const alert = await prisma.alert.findFirst({ where: { fingerprint: containerAlertFingerprint(host.id, container) }, orderBy: { updatedAt: 'desc' } })
  if (!alert) return
  const metadata = alert.metadata && typeof alert.metadata === 'object' && !Array.isArray(alert.metadata) ? alert.metadata as Record<string, unknown> : {}
  await prisma.alert.update({
    where: { id: alert.id },
    data: {
      metadata: {
        ...metadata,
        recoveredAfterResolve: true,
        recovery: { hostId: host.id, hostIp: host.ip, hostname: host.hostname, containerId: container.containerId, containerName: container.name, previousState, currentState, recoveredAt: new Date().toISOString() },
      } as Prisma.InputJsonValue,
    },
  })
  if (alert.status !== '已解决') await resolveAlert(alert.id, 'Agent容器监控')
}

async function syncContainerAlert(host: HostSummary, container: HostContainerRow, previousState?: string) {
  if (container.retiredReason === 'superseded_by_active_container') return
  const currentState = normalizedState(container.state)
  if (isHealthyContainerState(currentState)) await resolveContainerAlert(host, container, previousState, currentState)
  else if (isAbnormalContainerState(currentState)) await createContainerAlert(host, container, previousState, currentState)
}

function containerData(container: AgentContainerInput, reportedAt: Date) {
  return {
    containerId: container.containerId,
    name: container.name,
    image: container.image,
    status: container.status,
    state: container.state,
    restartCount: container.restartCount ?? 0,
    ports: container.ports as Prisma.InputJsonValue | undefined,
    cpuPercent: optionalInt(container.cpuPercent),
    memoryUsageBytes: optionalBigInt(container.memoryUsageBytes),
    memoryLimitBytes: optionalBigInt(container.memoryLimitBytes),
    memoryPercent: optionalInt(container.memoryPercent),
    networkRxBytes: optionalBigInt(container.networkRxBytes),
    networkTxBytes: optionalBigInt(container.networkTxBytes),
    blockReadBytes: optionalBigInt(container.blockReadBytes),
    blockWriteBytes: optionalBigInt(container.blockWriteBytes),
    labels: container.labels as Prisma.InputJsonValue | undefined,
    startedAt: optionalDate(container.startedAt),
    lastReportedAt: container.lastReportedAt ? new Date(container.lastReportedAt) : reportedAt,
    logicalKey: containerLogicalKey(container),
  }
}

export async function getHostContainers(hostId: string) {
  const containers = await prisma.hostContainer.findMany({ where: { hostId, isCurrent: true }, orderBy: [{ state: 'asc' }, { name: 'asc' }] })
  return containers.map(toItem)
}

export async function ingestHostContainers(hostId: string, containers: AgentContainerInput[]) {
  const host = await prisma.host.findUnique({ where: { id: hostId }, select: { id: true, ip: true, hostname: true, owner: true } })
  if (!host) throw new Error('主机不存在')
  const now = new Date()
  const existing = await prisma.hostContainer.findMany({ where: { hostId } })
  const previousById = new Map(existing.map((container) => [container.containerId, container]))
  const reportedIds = containers.map((container) => container.containerId)
  const incoming = containers.map((container) => ({ container, data: containerData(container, now) }))
  const activeLogicalKeys = new Set(incoming.filter(({ container }) => isActiveState(container.state)).map(({ data }) => data.logicalKey))
  const changedIds = new Set<string>()
  await prisma.$transaction(async (tx) => {
    const missing = await tx.hostContainer.findMany({ where: { hostId, containerId: { notIn: reportedIds }, state: { not: 'missing' } }, select: { containerId: true } })
    missing.forEach((container) => changedIds.add(container.containerId))
    await tx.hostContainer.updateMany({
      where: { hostId, containerId: { notIn: reportedIds } },
      data: { state: 'missing', status: '未在本次上报中出现', lastReportedAt: now, isCurrent: false, retiredAt: now, retiredReason: 'absent_from_latest_report' },
    })
    for (const { container, data } of incoming) {
      const previous = previousById.get(container.containerId)
      if (!previous || normalizedState(previous.state) !== normalizedState(container.state)) changedIds.add(container.containerId)
      const superseded = !isActiveState(container.state) && activeLogicalKeys.has(data.logicalKey)
      await tx.hostContainer.upsert({
        where: { hostId_containerId: { hostId, containerId: container.containerId } },
        create: { hostId, ...data, isCurrent: !superseded, retiredAt: superseded ? now : null, retiredReason: superseded ? 'superseded_by_active_container' : null },
        update: { ...data, isCurrent: !superseded, retiredAt: superseded ? now : null, retiredReason: superseded ? 'superseded_by_active_container' : null },
      })
    }
    const activeIncoming = incoming.filter(({ container }) => isActiveState(container.state))
    for (const { container, data } of activeIncoming) {
      await tx.hostContainer.updateMany({
        where: { hostId, logicalKey: data.logicalKey, containerId: { not: container.containerId }, state: { in: ['exited', 'dead', 'missing', 'removed', 'unknown'] } },
        data: { isCurrent: false, retiredAt: now, retiredReason: 'superseded_by_active_container' },
      })
    }
  })

  const changedContainers = changedIds.size
    ? await prisma.hostContainer.findMany({ where: { hostId, containerId: { in: [...changedIds] } } })
    : []
  for (const container of changedContainers) {
    const previous = previousById.get(container.containerId)
    await syncContainerAlert(host, container, previous?.state)
  }

  const abnormalCurrent = await prisma.hostContainer.findMany({ where: { hostId, state: { in: [...abnormalContainerStates] } } })
  for (const container of abnormalCurrent) await syncContainerAlert(host, container, previousById.get(container.containerId)?.state)

  return containers.length
}
