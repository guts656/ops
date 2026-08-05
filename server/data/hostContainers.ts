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

function containerServiceName(container: Pick<HostContainerRow, 'name' | 'labels'>) {
  const labels = labelsOf(container.labels)
  return labelString(labels, ['com.docker.swarm.service.name', 'com.docker.compose.service']) || normalizeContainerName(container.name)
}

function containerReplacementKey(container: { name: string; labels?: unknown; logicalKey?: string | null }) {
  const labels = labelsOf(container.labels)
  const serviceName = labelString(labels, ['com.docker.swarm.service.name'])
  if (!serviceName) return container.logicalKey || `name:${normalizeContainerName(container.name)}`
  const taskName = labelString(labels, ['com.docker.swarm.task.name']) || container.name
  const suffix = taskName.startsWith(`${serviceName}.`) ? taskName.slice(serviceName.length + 1) : ''
  const slot = suffix.split('.')[0]
  return `${container.logicalKey || `swarm:${serviceName}`}:slot:${/^\d+$/.test(slot) ? slot : 'unknown'}`
}

function normalizedState(state: string | null | undefined) {
  return String(state || '').trim().toLowerCase()
}

function isActiveState(state: string) {
  return ['running', 'restarting', 'paused', 'created'].includes(normalizedState(state))
}

type ExistingContainerSnapshot = Pick<HostContainerRow, 'containerId' | 'name' | 'labels' | 'logicalKey' | 'state' | 'restartCount' | 'isCurrent'>
type ContainerRestartPair = { previousContainerId: string; currentContainerId: string }

export function detectContainerRestartEvents(existing: ExistingContainerSnapshot[], containers: AgentContainerInput[]) {
  const previousById = new Map(existing.map((container) => [container.containerId, container]))
  const incoming = containers.map((container) => ({ container, logicalKey: containerLogicalKey(container) }))
  const incomingById = new Map(incoming.map((item) => [item.container.containerId, item]))
  const stoppedPreviousByKey = new Map<string, ExistingContainerSnapshot[]>()

  for (const previous of existing.filter((container) => container.isCurrent)) {
    const reported = incomingById.get(previous.containerId)
    if (reported && isActiveState(reported.container.state)) continue
    const key = containerReplacementKey({
      name: reported?.container.name || previous.name,
      labels: reported?.container.labels || previous.labels,
      logicalKey: reported?.logicalKey || previous.logicalKey,
    })
    stoppedPreviousByKey.set(key, [...(stoppedPreviousByKey.get(key) ?? []), previous])
  }

  const replacementPairs: ContainerRestartPair[] = []
  for (const { container, logicalKey } of incoming.filter(({ container }) => isActiveState(container.state) && !previousById.has(container.containerId))) {
    const key = containerReplacementKey({ name: container.name, labels: container.labels, logicalKey })
    const candidates = stoppedPreviousByKey.get(key) ?? []
    const previous = candidates.shift()
    if (previous) replacementPairs.push({ previousContainerId: previous.containerId, currentContainerId: container.containerId })
  }

  const restartCountPairs = incoming.flatMap(({ container }) => {
    const previous = previousById.get(container.containerId)
    return previous && (container.restartCount ?? 0) > previous.restartCount
      ? [{ previousContainerId: previous.containerId, currentContainerId: container.containerId }]
      : []
  })

  return { replacementPairs, restartCountPairs }
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

function containerRestartFingerprint(hostId: string, container: Pick<HostContainerRow, 'containerId' | 'restartCount'>) {
  return `agent-container-restart:${hostId}:${container.containerId}:${container.restartCount}`
}

function exitCodeFromStatus(status: string | null | undefined) {
  const matched = String(status || '').match(/Exited\s*\((-?\d+)\)/i)
  return matched ? Number(matched[1]) : undefined
}

export function containerRestartAlertLevel(status: string | null | undefined) {
  const exitCode = exitCodeFromStatus(status)
  return exitCode !== undefined && exitCode !== 0 ? '严重' as const : '警告' as const
}

async function createContainerRestartAlert(host: HostSummary, current: HostContainerRow, previous: HostContainerRow, reason: 'task_replaced' | 'restart_count_increased') {
  const serviceName = containerServiceName(current)
  const exitCode = exitCodeFromStatus(previous.status)
  const restartDelta = Math.max(1, current.restartCount - previous.restartCount)
  const reasonText = reason === 'task_replaced'
    ? `旧任务 ${previous.name}（${previous.containerId.slice(0, 12)}）退出后，由新任务 ${current.name}（${current.containerId.slice(0, 12)}）接管`
    : `容器重启次数从 ${previous.restartCount} 增加到 ${current.restartCount}（本次增加 ${restartDelta}）`
  await ingestAlert({
    source: 'Agent容器监控',
    level: containerRestartAlertLevel(previous.status),
    service: `container:${serviceName}`,
    title: `容器发生重启：${serviceName}`,
    content: `主机 ${host.ip} · ${host.hostname} 上的容器服务 ${serviceName} 发生重启。${reasonText}。旧状态：${previous.state} / ${previous.status}；当前状态：${current.state} / ${current.status}；镜像：${current.image}。`,
    owner: host.owner || 'Agent容器监控',
    relatedType: 'host_container',
    relatedId: current.id,
    fingerprint: containerRestartFingerprint(host.id, current),
    metadata: {
      hostId: host.id,
      hostIp: host.ip,
      hostname: host.hostname,
      eventType: reason === 'task_replaced' ? 'container_task_replaced' : 'container_restart_count_increased',
      logicalKey: current.logicalKey,
      serviceName,
      image: current.image,
      previousContainerId: previous.containerId,
      previousContainerName: previous.name,
      previousState: previous.state,
      previousStatus: previous.status,
      previousRestartCount: previous.restartCount,
      currentContainerId: current.containerId,
      currentContainerName: current.name,
      currentState: current.state,
      currentStatus: current.status,
      currentRestartCount: current.restartCount,
      restartDelta,
      exitCode,
    },
  })
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
  const previous = normalizedState(previousState)
  if (!container.isCurrent && (currentState === 'missing' || currentState === 'removed') && previous === currentState) return
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
  const { replacementPairs, restartCountPairs } = detectContainerRestartEvents(existing, containers)
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

  const restartContainerIds = Array.from(new Set([...replacementPairs, ...restartCountPairs].flatMap((pair) => [pair.previousContainerId, pair.currentContainerId])))
  const restartContainers = restartContainerIds.length
    ? await prisma.hostContainer.findMany({ where: { hostId, containerId: { in: restartContainerIds } } })
    : []
  const restartContainersById = new Map(restartContainers.map((container) => [container.containerId, container]))
  for (const pair of replacementPairs) {
    const previous = restartContainersById.get(pair.previousContainerId)
    const current = restartContainersById.get(pair.currentContainerId)
    if (previous && current) await createContainerRestartAlert(host, current, previous, 'task_replaced')
  }
  for (const pair of restartCountPairs) {
    const previous = previousById.get(pair.previousContainerId)
    const current = restartContainersById.get(pair.currentContainerId)
    if (previous && current) await createContainerRestartAlert(host, current, previous, 'restart_count_increased')
  }

  return containers.length
}
