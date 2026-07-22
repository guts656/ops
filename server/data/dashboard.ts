import { prisma } from '../db/prisma'
import { getDashboardTradingSessionSettings } from './settings.ts'
import { isTradingTime } from '../utils/tradingSessions.ts'

function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

function avg(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, Math.round(value * 10) / 10))
}

type ServiceStatusBucket = 'healthy' | 'warning' | 'abnormal' | 'unknown'
type ServiceAlertKind = 'log' | 'status' | 'other'

type ServiceHostRow = {
  hostId: string
  ip: string
  hostname: string
  hostStatus: string
  status: string
  statusBucket: ServiceStatusBucket
  port?: number | null
  source: string
  kind: 'service' | 'container'
  lastReportedAt: Date
  activeAlerts: number
}

type ServiceAggregate = {
  key: string
  name: string
  hosts: ServiceHostRow[]
  affectedHostIds: Set<string>
  activeAlerts: number
  criticalAlerts: number
  severeAlerts: number
  warningAlerts: number
  infoAlerts: number
  logAlerts: number
  statusAlerts: number
  otherAlerts: number
  errorLogsToday: number
  latestAlertAt?: Date
}

function normalizeServiceName(name: string) {
  const value = String(name || '').trim()
  const withoutPrefix = value.startsWith('container:') ? value.slice('container:'.length) : value
  const swarmTaskName = withoutPrefix.match(/^(.+)\.\d+\.[a-z0-9]{8,}$/i)
  return swarmTaskName ? swarmTaskName[1] : withoutPrefix
}

function labelsObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function labelString(labels: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = labels[key]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function normalizedContainerState(state: string | null | undefined) {
  return String(state || '').trim().toLowerCase()
}

function isActiveContainerState(state: string | null | undefined) {
  return ['running', 'restarting', 'paused', 'created'].includes(normalizedContainerState(state))
}

function swarmTaskKey(container: { name: string; labels?: unknown }) {
  const labels = labelsObject(container.labels)
  const service = labelString(labels, ['com.docker.swarm.service.name'])
  if (!service) return ''
  const taskName = container.name.replace(/^\//, '')
  const match = taskName.match(/^(.+)\.(\d+)\.[^.]+$/)
  if (!match) return ''
  const [, taskService, slot] = match
  if (normalizeServiceName(taskService) !== normalizeServiceName(service)) return ''
  return `swarm:${normalizeServiceName(service)}:${slot}`
}

function visibleServiceContainers<T extends { name: string; state: string | null; labels?: unknown }>(containers: T[]) {
  const activeSwarmTasks = new Set(containers.filter((container) => isActiveContainerState(container.state)).map(swarmTaskKey).filter(Boolean))
  if (!activeSwarmTasks.size) return containers
  return containers.filter((container) => {
    const taskKey = swarmTaskKey(container)
    return !taskKey || isActiveContainerState(container.state) || !activeSwarmTasks.has(taskKey)
  })
}

function isGenericServiceScope(name: string) {
  const value = normalizeServiceName(name).toLowerCase()
  return !value || ['全部主机', '全部服务', 'all hosts', 'all services', '*'].includes(value)
}

function canCreateServiceFromAlert(alert: { service: string; relatedType: string | null; fingerprint: string | null }) {
  if (isGenericServiceScope(alert.service)) return false
  return alert.relatedType === 'host_service' || String(alert.fingerprint || '').startsWith('agent-service:')
}

function normalizeServiceStatus(status: string | null | undefined): ServiceStatusBucket {
  const value = String(status || '').trim().toLowerCase()
  if (!value) return 'unknown'
  if (['running', 'active', 'healthy', 'ok', 'up', '正常', '健康'].includes(value)) return 'healthy'
  if (['degraded', 'warn', 'warning', '警告', 'restarting', 'activating', 'paused'].includes(value)) return 'warning'
  if (['failed', 'error', '异常', 'exited', 'dead', 'stopped', 'inactive', 'not_running', 'missing', 'removed', 'down'].includes(value)) return 'abnormal'
  if (value === 'unknown') return 'unknown'
  return 'unknown'
}

function dateKey(date: Date) {
  return `${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`
}

function trendDates() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date()
    date.setDate(date.getDate() - (6 - index))
    date.setHours(0, 0, 0, 0)
    return date
  })
}

function shanghaiTime(date: Date | string | null) {
  if (!date) return '-'
  const d = typeof date === 'string' ? new Date(date) : date
  return d.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function createServiceAggregate(name: string): ServiceAggregate {
  return {
    key: name,
    name,
    hosts: [],
    affectedHostIds: new Set<string>(),
    activeAlerts: 0,
    criticalAlerts: 0,
    severeAlerts: 0,
    warningAlerts: 0,
    infoAlerts: 0,
    logAlerts: 0,
    statusAlerts: 0,
    otherAlerts: 0,
    errorLogsToday: 0,
  }
}

function ensureService(map: Map<string, ServiceAggregate>, name: string) {
  const key = normalizeServiceName(name)
  if (!key) return undefined
  const current = map.get(key)
  if (current) return current
  const next = createServiceAggregate(key)
  map.set(key, next)
  return next
}

function classifyServiceAlert(alert: { source: string; relatedType: string | null; fingerprint: string | null }): ServiceAlertKind {
  const source = alert.source || ''
  const relatedType = alert.relatedType || ''
  const fingerprint = alert.fingerprint || ''
  if (source.includes('日志') || source.toLowerCase().includes('log') || relatedType === 'log_monitor_rule') return 'log'
  if (source === 'Agent服务监控' || relatedType === 'host_service' || fingerprint.startsWith('agent-service:')) return 'status'
  return 'other'
}

function metadataObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function metadataString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function metadataStringArray(value: unknown) {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()))
}

function hostIdsFromAlertMetadata(metadata: unknown) {
  const data = metadataObject(metadata)
  const ids = new Set<string>()
  const direct = metadataString(data.hostId) || metadataString(data.sourceHostId)
  if (direct) ids.add(direct)
  for (const id of metadataStringArray(data.matchedHostIds)) ids.add(id)
  for (const id of metadataStringArray(data.hostIds)) ids.add(id)
  return ids
}

function levelKey(level: string) {
  if (level === '紧急') return 'criticalAlerts'
  if (level === '严重') return 'severeAlerts'
  if (level === '警告') return 'warningAlerts'
  return 'infoAlerts'
}

function computeServiceHealthScore(service: ServiceAggregate) {
  const healthyInstances = service.hosts.filter((host) => host.statusBucket === 'healthy').length
  const warningInstances = service.hosts.filter((host) => host.statusBucket === 'warning').length
  const abnormalInstances = service.hosts.filter((host) => host.statusBucket === 'abnormal').length
  const unknownInstances = service.hosts.filter((host) => host.statusBucket === 'unknown').length
  const base = service.hosts.length ? (healthyInstances / service.hosts.length) * 100 : 100
  const alertPenalty = service.criticalAlerts * 12 + service.severeAlerts * 8 + service.warningAlerts * 4 + service.infoAlerts * 1
  const instancePenalty = warningInstances * 4 + abnormalInstances * 10 + unknownInstances * 3
  const logPenalty = Math.min(service.errorLogsToday * 0.5, 15)
  return clampScore(base - alertPenalty - instancePenalty - logPenalty)
}

function aggregateStatus(service: ServiceAggregate, healthScore: number) {
  const hasAbnormal = service.hosts.some((host) => host.statusBucket === 'abnormal')
  const hasWarning = service.hosts.some((host) => host.statusBucket === 'warning' || host.statusBucket === 'unknown')
  if (hasAbnormal || service.criticalAlerts > 0 || service.severeAlerts > 0 || healthScore < 70) return '异常'
  if (hasWarning || service.activeAlerts > 0 || service.errorLogsToday > 0 || healthScore < 90) return '警告'
  return '健康'
}

function latestDate(values: Array<Date | undefined>) {
  const dates = values.filter((value): value is Date => Boolean(value))
  if (!dates.length) return undefined
  return dates.reduce((latest, value) => value.getTime() > latest.getTime() ? value : latest, dates[0])
}

function scoreTrendType(score: number) {
  if (score >= 90) return 'up'
  if (score >= 70) return 'warning'
  return 'danger'
}

type ResourceSample = { cpu: number; memory: number; disk: number }

function averageResources(samples: ResourceSample[]) {
  return { cpu: avg(samples.map((sample) => sample.cpu)), memory: avg(samples.map((sample) => sample.memory)), disk: avg(samples.map((sample) => sample.disk)) }
}

export async function getDashboardData() {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTrend = trendDates()[0]
  const tradingSessionSettings = await getDashboardTradingSessionSettings()
  const resourceWindowStart = new Date(Date.now() - tradingSessionSettings.windowDays * 24 * 60 * 60 * 1000)

  const hostSelect = { id: true, ip: true, hostname: true, status: true, os: true, group: true, maintenanceEnabled: true }
  const [
    hosts, activeAlerts, todayAlerts, trendAlerts,
    hostServices, hostContainers, errorLogs, serviceAlerts, recentAlerts,
    batchJobs, selfHealingRules, logMonitorRules,
    recentBatchJobs, recentSelfHealing, resourcePoints,
  ] = await Promise.all([
    prisma.host.findMany({ select: { id: true, ip: true, hostname: true, cpu: true, memory: true, disk: true, status: true, os: true } }),
    prisma.alert.count({ where: { status: { not: '已解决' }, isSuppressed: false } }),
    prisma.alert.count({ where: { createdAt: { gte: startOfToday }, isSuppressed: false } }),
    prisma.alert.findMany({ where: { createdAt: { gte: startOfTrend }, isSuppressed: false }, select: { createdAt: true } }),
    prisma.hostService.findMany({
      where: { host: { os: { not: 'Linux' } }, NOT: { metadata: { path: ['hiddenStoppedBaseline'], equals: true } } },
      select: { id: true, hostId: true, name: true, status: true, port: true, source: true, lastReportedAt: true, host: { select: hostSelect } },
      orderBy: { lastReportedAt: 'desc' },
    }),
    prisma.hostContainer.findMany({
      where: { isCurrent: true },
      select: { id: true, hostId: true, name: true, state: true, status: true, labels: true, lastReportedAt: true, host: { select: hostSelect } },
      orderBy: { lastReportedAt: 'desc' },
    }),
    prisma.appLog.groupBy({ by: ['service'], where: { level: 'ERROR', timestamp: { gte: startOfToday } }, _count: { _all: true } }),
    prisma.alert.findMany({
      where: { status: { not: '已解决' }, isSuppressed: false, service: { not: '' } },
      select: { id: true, level: true, service: true, source: true, relatedType: true, fingerprint: true, metadata: true, createdAt: true, updatedAt: true },
      orderBy: { updatedAt: 'desc' },
    }),
    prisma.alert.findMany({ where: { status: { not: '已解决' }, isSuppressed: false }, orderBy: { updatedAt: 'desc' }, take: 3 }),
    // 扩展统计
    prisma.batchJob.findMany({ select: { status: true } }),
    prisma.selfHealingRule.findMany({ select: { enabled: true } }),
    prisma.logMonitorRule.findMany({ select: { id: true } }),
    // 最近活动
    prisma.batchJob.findMany({ orderBy: { startedAt: 'desc' }, take: 5, include: { targets: true } }),
    prisma.selfHealingExecution.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
    prisma.hostResourcePoint.findMany({
      where: { sampledAt: { gte: resourceWindowStart }, host: { status: '在线', maintenanceEnabled: false } },
      select: { sampledAt: true, cpu: true, memory: true, disk: true },
    }),
  ])

  const onlineHosts = hosts.filter((host) => host.status === '在线').length
  const hostOnlineRate = hosts.length ? (onlineHosts / hosts.length) * 100 : 100
  const tradingResourcePoints = resourcePoints.filter((point) => isTradingTime(point.sampledAt, 'CN_INTERNAL', tradingSessionSettings))
  const fallbackResources = averageResources(hosts.map((host) => ({ cpu: host.cpu, memory: host.memory, disk: host.disk })))
  const resourceAverages = tradingResourcePoints.length ? averageResources(tradingResourcePoints) : fallbackResources
  const avgCpu = resourceAverages.cpu
  const avgMemory = resourceAverages.memory
  const avgDisk = resourceAverages.disk
  const resourceScore = clampScore(100 - Math.max(avgCpu, avgMemory, avgDisk))
  const alertScore = clampScore(100 - activeAlerts * 8)
  const errorCountByService = Object.fromEntries(errorLogs.map((row) => [row.service, row._count._all]))

  const servicesByName = new Map<string, ServiceAggregate>()
  for (const service of hostServices) {
    const aggregate = ensureService(servicesByName, service.name)
    if (!aggregate) continue
    const row: ServiceHostRow = {
      hostId: service.hostId,
      ip: service.host.ip,
      hostname: service.host.hostname,
      hostStatus: service.host.status,
      status: service.status,
      statusBucket: normalizeServiceStatus(service.status),
      port: service.port,
      source: service.source,
      kind: 'service',
      lastReportedAt: service.lastReportedAt,
      activeAlerts: 0,
    }
    aggregate.hosts.push(row)
  }

  const serviceContainers = visibleServiceContainers(hostContainers)
  for (const container of serviceContainers) {
    const aggregate = ensureService(servicesByName, container.name)
    if (!aggregate) continue
    const row: ServiceHostRow = {
      hostId: container.hostId,
      ip: container.host.ip,
      hostname: container.host.hostname,
      hostStatus: container.host.status,
      status: container.state || container.status,
      statusBucket: normalizeServiceStatus(container.state || container.status),
      port: null,
      source: 'container',
      kind: 'container',
      lastReportedAt: container.lastReportedAt,
      activeAlerts: 0,
    }
    aggregate.hosts.push(row)
  }

  for (const [name, count] of Object.entries(errorCountByService)) {
    const aggregate = servicesByName.get(normalizeServiceName(name))
    if (aggregate) aggregate.errorLogsToday = count
  }

  for (const alert of serviceAlerts) {
    const serviceKey = normalizeServiceName(alert.service)
    const aggregate = servicesByName.get(serviceKey) ?? (canCreateServiceFromAlert(alert) ? ensureService(servicesByName, alert.service) : undefined)
    if (!aggregate) continue
    aggregate.activeAlerts += 1
    const key = levelKey(alert.level)
    aggregate[key] += 1
    const kind = classifyServiceAlert(alert)
    if (kind === 'log') aggregate.logAlerts += 1
    else if (kind === 'status') aggregate.statusAlerts += 1
    else aggregate.otherAlerts += 1
    aggregate.latestAlertAt = latestDate([aggregate.latestAlertAt, alert.updatedAt, alert.createdAt])

    const hostIds = hostIdsFromAlertMetadata(alert.metadata)
    for (const hostId of hostIds) {
      aggregate.affectedHostIds.add(hostId)
      const row = aggregate.hosts.find((host) => host.hostId === hostId)
      if (row) row.activeAlerts += 1
    }
  }

  const uploadedServiceInstanceCount = hostServices.length
  const uniqueServiceNameCount = new Set(hostServices.map((service) => normalizeServiceName(service.name)).filter(Boolean)).size
  const containerInstanceTotal = serviceContainers.length

  const services = Array.from(servicesByName.values()).map((service) => {
    const serviceHosts = service.hosts.filter((host) => host.kind === 'service')
    const containerHosts = service.hosts.filter((host) => host.kind === 'container')
    const countByBucket = (rows: ServiceHostRow[], bucket: ServiceStatusBucket) => rows.filter((host) => host.statusBucket === bucket).length
    const healthyInstances = countByBucket(service.hosts, 'healthy')
    const warningInstances = countByBucket(service.hosts, 'warning')
    const abnormalInstances = countByBucket(service.hosts, 'abnormal')
    const unknownInstances = countByBucket(service.hosts, 'unknown')
    const healthyServiceInstanceCount = countByBucket(serviceHosts, 'healthy')
    const warningServiceInstanceCount = countByBucket(serviceHosts, 'warning')
    const abnormalServiceInstanceCount = countByBucket(serviceHosts, 'abnormal')
    const unknownServiceInstanceCount = countByBucket(serviceHosts, 'unknown')
    const healthyContainerInstanceCount = countByBucket(containerHosts, 'healthy')
    const warningContainerInstanceCount = countByBucket(containerHosts, 'warning')
    const abnormalContainerInstanceCount = countByBucket(containerHosts, 'abnormal')
    const unknownContainerInstanceCount = countByBucket(containerHosts, 'unknown')
    const totalInstanceCount = service.hosts.length
    const affectedHostIds = new Set(service.affectedHostIds)
    for (const host of service.hosts) if (host.statusBucket !== 'healthy' || host.activeAlerts > 0) affectedHostIds.add(host.hostId)
    const healthScore = computeServiceHealthScore(service)
    const status = aggregateStatus(service, healthScore)
    const lastReportedAt = latestDate(service.hosts.map((host) => host.lastReportedAt))
    return {
      key: service.key,
      name: service.name,
      status,
      healthScore,
      instances: totalInstanceCount,
      totalInstanceCount,
      serviceInstanceCount: serviceHosts.length,
      healthyServiceInstanceCount,
      warningServiceInstanceCount,
      abnormalServiceInstanceCount,
      unknownServiceInstanceCount,
      containerInstanceCount: containerHosts.length,
      healthyContainerInstanceCount,
      warningContainerInstanceCount,
      abnormalContainerInstanceCount,
      unknownContainerInstanceCount,
      healthyInstances,
      warningInstances,
      abnormalInstances,
      unknownInstances,
      availability: `${healthyInstances}/${totalInstanceCount}`,
      hostCount: new Set(service.hosts.map((host) => host.hostId)).size,
      affectedHosts: affectedHostIds.size,
      activeAlerts: service.activeAlerts,
      criticalAlerts: service.criticalAlerts,
      severeAlerts: service.severeAlerts,
      warningAlerts: service.warningAlerts,
      infoAlerts: service.infoAlerts,
      logAlerts: service.logAlerts,
      statusAlerts: service.statusAlerts,
      otherAlerts: service.otherAlerts,
      errorLogsToday: service.errorLogsToday,
      qps: 0,
      errorRate: service.errorLogsToday ? `${service.errorLogsToday} 条错误` : '0%',
      lastReportedAt: shanghaiTime(lastReportedAt ?? null),
      latestAlertAt: shanghaiTime(service.latestAlertAt ?? null),
      hosts: service.hosts
        .sort((left, right) => (right.activeAlerts - left.activeAlerts) || left.hostname.localeCompare(right.hostname))
        .map((host) => ({
          ...host,
          lastReportedAt: shanghaiTime(host.lastReportedAt),
        })),
    }
  }).sort((left, right) => {
    const rank = { '异常': 0, '警告': 1, '健康': 2 }
    return rank[left.status] - rank[right.status]
      || right.activeAlerts - left.activeAlerts
      || right.abnormalInstances - left.abnormalInstances
      || right.instances - left.instances
      || left.name.localeCompare(right.name)
  })

  const aggregateNameCount = services.length
  const reportedInstanceCount = uploadedServiceInstanceCount + containerInstanceTotal
  const serviceCount = uniqueServiceNameCount
  const instanceCount = uploadedServiceInstanceCount
  const healthyServiceCount = services.filter((service) => service.status === '健康').length
  const warningServiceCount = services.filter((service) => service.status === '警告').length
  const abnormalServiceCount = services.filter((service) => service.status === '异常').length
  const serviceWeightTotal = services.reduce((sum, service) => sum + Math.max(1, Math.min(service.instances || 1, 10)), 0)
  const serviceHealthScore = serviceWeightTotal
    ? services.reduce((sum, service) => sum + service.healthScore * Math.max(1, Math.min(service.instances || 1, 10)), 0) / serviceWeightTotal
    : 100
  const serviceHealth = {
    score: clampScore(serviceHealthScore),
    serviceCount,
    instanceCount,
    uniqueServiceNameCount,
    uploadedServiceInstanceCount,
    containerInstanceCount: containerInstanceTotal,
    aggregateNameCount,
    reportedInstanceCount,
    healthyServiceCount,
    warningServiceCount,
    abnormalServiceCount,
    activeServiceAlertCount: services.reduce((sum, service) => sum + service.activeAlerts, 0),
    logAlertCount: services.reduce((sum, service) => sum + service.logAlerts, 0),
    statusAlertCount: services.reduce((sum, service) => sum + service.statusAlerts, 0),
  }
  const healthValue = clampScore(hostOnlineRate * 0.25 + serviceHealth.score * 0.35 + resourceScore * 0.2 + alertScore * 0.2)

  const trendCounts = new Map(trendDates().map((date) => [dateKey(date), 0]))
  for (const alert of trendAlerts) {
    const key = dateKey(alert.createdAt)
    trendCounts.set(key, (trendCounts.get(key) ?? 0) + 1)
  }

  // 扩展统计
  const batchSuccess = batchJobs.filter((j) => j.status === 'success').length
  const batchFailed = batchJobs.filter((j) => j.status === 'failed' || j.status === 'partial').length
  const enabledSelfHealing = selfHealingRules.filter((r) => r.enabled).length

  return {
    metrics: [
      { key: 'health', title: '系统健康度', value: percent(healthValue), trend: `主机25% / 服务可用性35% / 资源20%（交易时段）/ 告警20%`, trendType: scoreTrendType(healthValue), color: healthValue >= 90 ? '#52c41a' : healthValue >= 70 ? '#faad14' : '#ff4d4f' },
      { key: 'alerts', title: '今日告警', value: todayAlerts, trend: `未解决 ${activeAlerts} 条`, trendType: activeAlerts ? 'danger' : 'down', color: '#ff4d4f' },
      { key: 'services', title: '服务可用性', value: percent(serviceHealth.score), trend: `服务名 ${uniqueServiceNameCount} / 服务实例 ${uploadedServiceInstanceCount} / 容器 ${containerInstanceTotal}`, trendType: scoreTrendType(serviceHealth.score), color: serviceHealth.score >= 90 ? '#52c41a' : serviceHealth.score >= 70 ? '#faad14' : '#ff4d4f' },
      { key: 'availability', title: '可用性', value: percent(hostOnlineRate, 2), trend: `${onlineHosts}/${hosts.length || 0} 主机在线`, trendType: hostOnlineRate >= 90 ? 'up' : 'danger', color: '#1677ff' },
      { key: 'batchJobs', title: '批处理任务', value: batchJobs.length, trend: `${batchSuccess} 成功 / ${batchFailed} 失败`, trendType: batchFailed ? 'danger' : 'up', color: '#722ed1' },
    ],
    resources: [
      { name: 'CPU 使用率', value: avgCpu, status: avgCpu > 85 ? 'exception' : 'active' },
      { name: '内存使用率', value: avgMemory, status: avgMemory > 85 ? 'exception' : 'normal' },
      { name: '磁盘使用率', value: avgDisk, status: avgDisk > 85 ? 'exception' : 'normal' },
    ],
    resourceMonitorMeta: {
      scope: 'trading_sessions',
      windowDays: tradingSessionSettings.windowDays,
      sampleCount: tradingResourcePoints.length,
      totalSampleCount: resourcePoints.length,
      fallback: tradingResourcePoints.length === 0,
      label: `近 ${tradingSessionSettings.windowDays} 天交易时段平均，已排除开盘前/收盘后/周末`,
    },
    services,
    serviceHealth,
    alertTrend: Array.from(trendCounts.entries()).map(([date, value]) => ({ date, value })),
    alerts: recentAlerts.map((alert) => ({
      id: alert.id,
      level: alert.level,
      time: alert.time,
      service: alert.service,
      content: alert.content,
      owner: alert.owner,
      status: alert.status,
      source: alert.source,
      title: alert.title || alert.content,
      occurrenceCount: alert.occurrenceCount,
      isSuppressed: alert.isSuppressed,
    })),
    // 扩展数据
    hosts: hosts.map((h) => ({ id: h.id, ip: h.ip, hostname: h.hostname, status: h.status, os: h.os })),
    stats: {
      hostCount: hosts.length,
      onlineHostCount: onlineHosts,
      alertCount: activeAlerts,
      batchJobCount: batchJobs.length,
      selfHealingCount: selfHealingRules.length,
      logMonitorCount: logMonitorRules.length,
      enabledSelfHealing,
    },
    recentBatchJobs: recentBatchJobs.map((j) => ({
      id: j.id,
      name: j.name,
      type: j.type,
      status: j.status,
      summary: j.summary,
      startedAt: shanghaiTime(j.startedAt),
      targetCount: j.targets.length,
      successCount: j.targets.filter((t) => t.status === 'success').length,
    })),
    recentSelfHealing: recentSelfHealing.map((e) => ({
      id: e.id,
      ruleName: e.ruleName,
      service: e.service,
      status: e.status,
      triggeredAt: e.triggeredAt,
      duration: e.duration,
    })),
  }
}
