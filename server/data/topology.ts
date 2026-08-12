import type { Topology, TopologyEdge, TopologyNode } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'

export type TopologyNodeType = 'business' | 'service' | 'host' | 'database' | 'middleware' | 'agent' | 'container' | 'note'

export interface TopologyInput {
  name: string
  type: string
  remark?: string
}

export interface TopologyNodeInput {
  name: string
  type: TopologyNodeType
  status?: string
  description?: string
  x?: number
  y?: number
}

export interface TopologyEdgeInput {
  sourceId: string
  targetId: string
  label: string
}

export interface TopologyNodePositionInput {
  id: string
  x: number
  y: number
}

interface TopologyNodeMeta {
  hostId?: string
  group?: string
  environment?: string
  tags?: string[]
}

interface GeneratedTopologyNode extends TopologyNodeInput {
  id: string
}

interface GeneratedTopologyEdge extends TopologyEdgeInput {
  id: string
}

const nodeTypes = new Set<TopologyNodeType>(['business', 'service', 'host', 'database', 'middleware', 'agent', 'container', 'note'])
const legacyDynamicNodePrefixes = ['dynamic-root', 'dynamic-host-', 'dynamic-agent-', 'dynamic-service-', 'dynamic-container-']
const legacyDynamicEdgePrefixes = ['dynamic-edge-']
const healthyStatuses = new Set(['running', 'active', 'online', 'healthy', 'up', 'ok', '正常', '在线', '健康'])
const offlineStatuses = new Set(['offline', 'down', 'unreachable', '离线', '不可达'])
const abnormalStatuses = new Set(['failed', 'error', 'dead', 'missing', 'removed', '异常', '故障'])
const stoppedStatuses = new Set(['stopped', 'inactive', 'not_running', 'exited', '停止', '已停止'])
const severeAlertLevels = new Set(['critical', 'fatal', 'emergency', '严重', '灾难'])

function deriveEnvironment(tags: string[] = [], group = '') {
  if (tags.some((tag) => tag.includes('生产')) || group.includes('生产') || group.includes('核心')) return '生产'
  if (tags.some((tag) => tag.includes('测试')) || group.includes('测试')) return '测试'
  return ''
}

function withNodeMeta(node: ReturnType<typeof toPlainNode>, meta?: TopologyNodeMeta) {
  return {
    ...node,
    ...(meta?.hostId ? { hostId: meta.hostId } : {}),
    ...(meta?.group ? { group: meta.group } : {}),
    ...(meta?.environment ? { environment: meta.environment } : {}),
    ...(meta?.tags?.length ? { tags: meta.tags } : {}),
  }
}

function clampPosition(value: number | undefined, fallback: number) {
  const next = Math.round(Number(value ?? fallback))
  if (!Number.isFinite(next)) return fallback
  return Math.min(1400, Math.max(0, next))
}

function normalizeStatus(value: string | null | undefined) {
  return value?.trim().toLowerCase() || ''
}

function normalizeTopologyInput(input: TopologyInput) {
  const name = input.name.trim()
  const type = input.type.trim()
  if (!name) throw new Error('拓扑名称不能为空')
  if (!type) throw new Error('拓扑类型不能为空')
  return { name, type, remark: input.remark?.trim() || '' }
}

function normalizeNodeInput(input: TopologyNodeInput) {
  const name = input.name.trim()
  if (!name) throw new Error('节点名称不能为空')
  if (!nodeTypes.has(input.type)) throw new Error('节点类型不支持')
  return {
    name,
    type: input.type,
    status: input.status?.trim() || '稳定',
    description: input.description?.trim() || '',
    x: clampPosition(input.x, 80),
    y: clampPosition(input.y, 80),
  }
}

function normalizeEdgeInput(input: TopologyEdgeInput) {
  const label = input.label.trim()
  if (!label) throw new Error('依赖说明不能为空')
  if (input.sourceId === input.targetId) throw new Error('依赖线不能连接同一个节点')
  return { sourceId: input.sourceId, targetId: input.targetId, label }
}

function toTopology(topology: Topology) {
  return {
    id: topology.id,
    name: topology.name,
    type: topology.type,
    remark: topology.remark,
    createdAt: topology.createdAt.toISOString(),
    updatedAt: topology.updatedAt.toISOString(),
  }
}

function toPlainNode(node: TopologyNode) {
  return {
    id: node.id,
    topologyId: node.topologyId,
    name: node.name,
    type: node.type as TopologyNodeType,
    status: node.status,
    description: node.description,
    x: node.x,
    y: node.y,
    createdAt: node.createdAt.toISOString(),
    updatedAt: node.updatedAt.toISOString(),
  }
}

function toNode(node: TopologyNode, meta?: TopologyNodeMeta) {
  return withNodeMeta(toPlainNode(node), meta)
}

function toEdge(edge: TopologyEdge) {
  return {
    id: edge.id,
    topologyId: edge.topologyId,
    sourceId: edge.sourceId,
    targetId: edge.targetId,
    label: edge.label,
    createdAt: edge.createdAt.toISOString(),
    updatedAt: edge.updatedAt.toISOString(),
  }
}

function alertBucket() {
  return { count: 0, severe: false }
}

function addAlert(bucket: ReturnType<typeof alertBucket>, level: string) {
  bucket.count += 1
  bucket.severe ||= severeAlertLevels.has(normalizeStatus(level))
}

function applyAlerts(status: string, bucket: ReturnType<typeof alertBucket> | undefined) {
  if (!bucket?.count) return status
  return bucket.severe ? `严重告警(${bucket.count})` : `告警(${bucket.count})`
}

function hostStatus(host: { status: string, cpu: number, memory: number, disk: number }) {
  const status = normalizeStatus(host.status)
  if (offlineStatuses.has(status)) return '离线'
  if (abnormalStatuses.has(status)) return '异常'
  if (host.cpu >= 90 || host.memory >= 90 || host.disk >= 90) return '资源高'
  if (healthyStatuses.has(status)) return '正常'
  return host.status || '未知'
}

function agentStatus(host: { agentStatus: string }) {
  const status = normalizeStatus(host.agentStatus)
  if (!status) return '未安装'
  if (healthyStatuses.has(status)) return '正常'
  if (offlineStatuses.has(status) || abnormalStatuses.has(status) || stoppedStatuses.has(status)) return '异常'
  return host.agentStatus
}

function serviceStatus(service: { status: string }) {
  const status = normalizeStatus(service.status)
  if (abnormalStatuses.has(status)) return '异常'
  if (stoppedStatuses.has(status)) return '停止'
  if (healthyStatuses.has(status)) return '正常'
  return service.status || '未知'
}

function containerStatus(container: { state: string, status: string }) {
  const state = normalizeStatus(container.state)
  if (abnormalStatuses.has(state) || stoppedStatuses.has(state)) return '异常'
  if (healthyStatuses.has(state)) return '正常'
  return container.state || container.status || '未知'
}

function scopedDynamicNodeWhere(topologyId: string) {
  return { topologyId, OR: [{ id: { startsWith: `dynamic-${topologyId}-` } }, ...legacyDynamicNodePrefixes.map((prefix) => ({ id: { startsWith: prefix } }))] }
}

function scopedDynamicEdgeWhere(topologyId: string) {
  return { topologyId, OR: [{ id: { startsWith: `dynamic-${topologyId}-edge-` } }, ...legacyDynamicEdgePrefixes.map((prefix) => ({ id: { startsWith: prefix } }))] }
}

function dynamicId(topologyId: string, value: string) {
  return `dynamic-${topologyId}-${value}`
}

function dynamicEdgeId(topologyId: string, value: string) {
  return `dynamic-${topologyId}-edge-${value}`
}

function upsertNodeOperation(topologyId: string, node: GeneratedTopologyNode) {
  const data = normalizeNodeInput(node)
  return prisma.topologyNode.upsert({
    where: { id: node.id },
    create: { id: node.id, topologyId, ...data },
    update: { topologyId, name: data.name, type: data.type, status: data.status, description: data.description },
  })
}

function upsertEdgeOperation(topologyId: string, edge: GeneratedTopologyEdge) {
  const data = normalizeEdgeInput(edge)
  return prisma.topologyEdge.upsert({
    where: { id: edge.id },
    create: { id: edge.id, topologyId, ...data },
    update: { topologyId, label: data.label, sourceId: data.sourceId, targetId: data.targetId },
  })
}

export async function listTopologies() {
  const topologies = await prisma.topology.findMany({ orderBy: [{ createdAt: 'desc' }] })
  return topologies.map(toTopology)
}

export async function createTopology(input: TopologyInput) {
  const topology = await prisma.topology.create({ data: normalizeTopologyInput(input) })
  return toTopology(topology)
}

export async function updateTopology(topologyId: string, input: TopologyInput) {
  const topology = await prisma.topology.update({ where: { id: topologyId }, data: normalizeTopologyInput(input) })
  return toTopology(topology)
}

export async function deleteTopology(topologyId: string) {
  await prisma.topology.delete({ where: { id: topologyId } })
}

export async function listTopology(topologyId: string) {
  const [nodes, edges, hosts] = await Promise.all([
    prisma.topologyNode.findMany({ where: { topologyId }, orderBy: [{ createdAt: 'asc' }] }),
    prisma.topologyEdge.findMany({ where: { topologyId }, orderBy: [{ createdAt: 'asc' }] }),
    prisma.host.findMany({
      select: {
        id: true,
        group: true,
        tags: true,
        services: { select: { id: true } },
        containers: { where: { isCurrent: true }, select: { id: true } },
      },
    }),
  ])
  const metaByNodeId = new Map<string, TopologyNodeMeta>()
  for (const host of hosts) {
    const meta = { hostId: host.id, group: host.group, environment: deriveEnvironment(host.tags, host.group), tags: host.tags }
    metaByNodeId.set(dynamicId(topologyId, `host-${host.id}`), meta)
    metaByNodeId.set(dynamicId(topologyId, `agent-${host.id}`), meta)
    metaByNodeId.set(`dynamic-host-${host.id}`, meta)
    metaByNodeId.set(`dynamic-agent-${host.id}`, meta)
    for (const service of host.services) {
      metaByNodeId.set(dynamicId(topologyId, `service-${service.id}`), meta)
      metaByNodeId.set(`dynamic-service-${service.id}`, meta)
    }
    for (const container of host.containers) {
      metaByNodeId.set(dynamicId(topologyId, `container-${container.id}`), meta)
      metaByNodeId.set(`dynamic-container-${container.id}`, meta)
    }
  }
  return { nodes: nodes.map((node) => toNode(node, metaByNodeId.get(node.id))), edges: edges.map(toEdge) }
}

export async function createTopologyNode(topologyId: string, input: TopologyNodeInput) {
  const node = await prisma.topologyNode.create({ data: { topologyId, ...normalizeNodeInput(input) } })
  return toNode(node)
}

export async function updateTopologyNode(topologyId: string, id: string, input: TopologyNodeInput) {
  const existing = await prisma.topologyNode.findFirst({ where: { id, topologyId }, select: { id: true } })
  if (!existing) throw new Error('节点不存在')
  const node = await prisma.topologyNode.update({ where: { id }, data: normalizeNodeInput(input) })
  return toNode(node)
}

export async function deleteTopologyNode(topologyId: string, id: string) {
  await prisma.topologyNode.deleteMany({ where: { id, topologyId } })
}

export async function createTopologyEdge(topologyId: string, input: TopologyEdgeInput) {
  const values = normalizeEdgeInput(input)
  const count = await prisma.topologyNode.count({ where: { topologyId, id: { in: [values.sourceId, values.targetId] } } })
  if (count !== 2) throw new Error('依赖线两端节点不存在')
  const edge = await prisma.topologyEdge.create({ data: { topologyId, ...values } })
  return toEdge(edge)
}

export async function updateTopologyEdge(topologyId: string, id: string, input: TopologyEdgeInput) {
  const values = normalizeEdgeInput(input)
  const [existing, count] = await Promise.all([
    prisma.topologyEdge.findFirst({ where: { id, topologyId }, select: { id: true } }),
    prisma.topologyNode.count({ where: { topologyId, id: { in: [values.sourceId, values.targetId] } } }),
  ])
  if (!existing) throw new Error('依赖线不存在')
  if (count !== 2) throw new Error('依赖线两端节点不存在')
  const edge = await prisma.topologyEdge.update({ where: { id }, data: values })
  return toEdge(edge)
}

export async function deleteTopologyEdge(topologyId: string, id: string) {
  await prisma.topologyEdge.deleteMany({ where: { id, topologyId } })
}

export async function updateTopologyNodePositions(topologyId: string, positions: TopologyNodePositionInput[]) {
  await prisma.$transaction(positions.map((position) => prisma.topologyNode.updateMany({
    where: { id: position.id, topologyId },
    data: { x: clampPosition(position.x, 80), y: clampPosition(position.y, 80) },
  })))
  return listTopology(topologyId)
}

export async function syncDynamicTopology(topologyId: string) {
  const [hosts, alerts] = await Promise.all([
    prisma.host.findMany({
      include: {
        services: { orderBy: [{ name: 'asc' }] },
        containers: { where: { isCurrent: true }, orderBy: [{ name: 'asc' }] },
      },
      orderBy: [{ group: 'asc' }, { ip: 'asc' }],
    }),
    prisma.alert.findMany({
      where: { status: { not: '已解决' }, isSuppressed: false },
      select: { level: true, service: true, relatedType: true, relatedId: true },
    }),
  ])
  const hostAlerts = new Map<string, ReturnType<typeof alertBucket>>()
  const serviceAlerts = new Map<string, ReturnType<typeof alertBucket>>()
  const containerAlerts = new Map<string, ReturnType<typeof alertBucket>>()
  const servicesById = new Map(hosts.flatMap((host) => host.services.map((service) => [service.id, { service, host }] as const)))
  const containersById = new Map(hosts.flatMap((host) => host.containers.map((container) => [container.id, { container, host }] as const)))
  const serviceIdsByName = new Map<string, string[]>()

  for (const { services } of hosts) {
    for (const service of services) {
      const name = service.name.trim().toLowerCase()
      serviceIdsByName.set(name, [...serviceIdsByName.get(name) ?? [], service.id])
    }
  }

  for (const alert of alerts) {
    if (alert.relatedType === 'host' && alert.relatedId) {
      const bucket = hostAlerts.get(alert.relatedId) ?? alertBucket()
      addAlert(bucket, alert.level)
      hostAlerts.set(alert.relatedId, bucket)
      continue
    }
    if (alert.relatedType === 'host_service' && alert.relatedId) {
      const service = servicesById.get(alert.relatedId)
      if (service) {
        const serviceBucket = serviceAlerts.get(alert.relatedId) ?? alertBucket()
        const hostBucket = hostAlerts.get(service.host.id) ?? alertBucket()
        addAlert(serviceBucket, alert.level)
        addAlert(hostBucket, alert.level)
        serviceAlerts.set(alert.relatedId, serviceBucket)
        hostAlerts.set(service.host.id, hostBucket)
        continue
      }
    }
    if (alert.relatedType === 'host_container' && alert.relatedId) {
      const container = containersById.get(alert.relatedId)
      if (container) {
        const containerBucket = containerAlerts.get(alert.relatedId) ?? alertBucket()
        const hostBucket = hostAlerts.get(container.host.id) ?? alertBucket()
        addAlert(containerBucket, alert.level)
        addAlert(hostBucket, alert.level)
        containerAlerts.set(alert.relatedId, containerBucket)
        hostAlerts.set(container.host.id, hostBucket)
        continue
      }
    }
    const matchedServiceIds = serviceIdsByName.get(alert.service.trim().toLowerCase()) ?? []
    for (const serviceId of matchedServiceIds) {
      const service = servicesById.get(serviceId)
      if (!service) continue
      const serviceBucket = serviceAlerts.get(serviceId) ?? alertBucket()
      const hostBucket = hostAlerts.get(service.host.id) ?? alertBucket()
      addAlert(serviceBucket, alert.level)
      addAlert(hostBucket, alert.level)
      serviceAlerts.set(serviceId, serviceBucket)
      hostAlerts.set(service.host.id, hostBucket)
    }
  }

  const rootNodeId = dynamicId(topologyId, 'root')
  const nodes: GeneratedTopologyNode[] = [{
    id: rootNodeId,
    name: '动态运维拓扑',
    type: 'note',
    status: alerts.length ? `活动告警(${alerts.length})` : '正常',
    description: `从 ${hosts.length} 台主机、${servicesById.size} 个服务、${containersById.size} 个容器和未解决告警自动同步。`,
    x: 40,
    y: 40,
  }]
  const edges: GeneratedTopologyEdge[] = []

  hosts.forEach((host, index) => {
    const blockHeight = Math.max(160, Math.max(host.services.length, host.containers.length) * 112)
    const baseY = 40 + index * blockHeight
    const hostNodeId = dynamicId(topologyId, `host-${host.id}`)
    const agentNodeId = dynamicId(topologyId, `agent-${host.id}`)

    nodes.push({
      id: hostNodeId,
      name: host.hostname || host.ip,
      type: 'host',
      status: applyAlerts(hostStatus(host), hostAlerts.get(host.id)),
      description: `${host.ip} · ${host.os} ${host.osVersion} · CPU ${host.cpu}% / 内存 ${host.memory}% / 磁盘 ${host.disk}% · 分组 ${host.group || '-'}`,
      x: 220,
      y: baseY,
    })
    nodes.push({
      id: agentNodeId,
      name: `${host.hostname || host.ip} Agent`,
      type: 'agent',
      status: agentStatus(host),
      description: `版本 ${host.agentVersion || '-'} · 最近心跳 ${host.lastHeartbeat || '-'}`,
      x: 420,
      y: baseY,
    })
    edges.push({ id: dynamicEdgeId(topologyId, `root-${host.id}`), sourceId: rootNodeId, targetId: hostNodeId, label: '纳管主机' })
    edges.push({ id: dynamicEdgeId(topologyId, `agent-${host.id}`), sourceId: hostNodeId, targetId: agentNodeId, label: 'Agent 状态' })

    host.services.forEach((service, serviceIndex) => {
      const serviceNodeId = dynamicId(topologyId, `service-${service.id}`)
      nodes.push({
        id: serviceNodeId,
        name: service.port ? `${service.name}:${service.port}` : service.name,
        type: 'service',
        status: applyAlerts(serviceStatus(service), serviceAlerts.get(service.id)),
        description: `${service.protocol || service.source || 'service'} · 版本 ${service.version || '-'} · 最近上报 ${service.lastReportedAt.toISOString()}`,
        x: 620,
        y: baseY + serviceIndex * 112,
      })
      edges.push({ id: dynamicEdgeId(topologyId, `service-${service.id}`), sourceId: agentNodeId, targetId: serviceNodeId, label: '服务探测' })
    })

    host.containers.forEach((container, containerIndex) => {
      const containerNodeId = dynamicId(topologyId, `container-${container.id}`)
      nodes.push({
        id: containerNodeId,
        name: container.name,
        type: 'container',
        status: applyAlerts(containerStatus(container), containerAlerts.get(container.id)),
        description: `${container.image} · ${container.status} · 重启 ${container.restartCount} 次`,
        x: 800,
        y: baseY + containerIndex * 112,
      })
      edges.push({ id: dynamicEdgeId(topologyId, `container-${container.id}`), sourceId: agentNodeId, targetId: containerNodeId, label: '容器采集' })
    })
  })

  const nodeIds = nodes.map((node) => node.id)
  const edgeIds = edges.map((edge) => edge.id)
  await prisma.$transaction([
    prisma.topologyEdge.deleteMany({ where: edgeIds.length ? { AND: [scopedDynamicEdgeWhere(topologyId), { id: { notIn: edgeIds } }] } : scopedDynamicEdgeWhere(topologyId) }),
    ...nodes.map((node) => upsertNodeOperation(topologyId, node)),
    prisma.topologyNode.deleteMany({ where: nodeIds.length ? { AND: [scopedDynamicNodeWhere(topologyId), { id: { notIn: nodeIds } }] } : scopedDynamicNodeWhere(topologyId) }),
    ...edges.map((edge) => upsertEdgeOperation(topologyId, edge)),
  ])
  return listTopology(topologyId)
}
