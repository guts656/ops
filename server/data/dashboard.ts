import { prisma } from '../db/prisma'

function percent(value: number, digits = 1) {
  return `${value.toFixed(digits)}%`
}

function avg(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function clampScore(value: number) {
  return Math.max(0, Math.min(100, value))
}

function serviceStatus(statuses: string[], errorCount: number) {
  if (statuses.some((status) => ['failed', 'error', '异常', 'exited', 'dead', 'stopped', 'inactive', 'not_running', 'missing', 'removed', 'unknown'].includes(status.toLowerCase())) || errorCount > 0) return '异常'
  if (statuses.some((status) => ['degraded', 'warn', 'warning', '警告', 'restarting', 'activating', 'paused'].includes(status.toLowerCase()))) return '警告'
  return '健康'
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

export async function getDashboardData() {
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)
  const startOfTrend = trendDates()[0]

  const [
    hosts, activeAlerts, todayAlerts, trendAlerts,
    hostServices, hostContainers, errorLogs, recentAlerts,
    batchJobs, selfHealingRules, logMonitorRules,
    recentBatchJobs, recentSelfHealing,
  ] = await Promise.all([
    prisma.host.findMany({ select: { id: true, ip: true, hostname: true, cpu: true, memory: true, disk: true, status: true, os: true } }),
    prisma.alert.count({ where: { status: { not: '已解决' }, isSuppressed: false } }),
    prisma.alert.count({ where: { createdAt: { gte: startOfToday }, isSuppressed: false } }),
    prisma.alert.findMany({ where: { createdAt: { gte: startOfTrend }, isSuppressed: false }, select: { createdAt: true } }),
    prisma.hostService.findMany({ where: { host: { os: { not: 'Linux' } }, NOT: { metadata: { path: ['hiddenStoppedBaseline'], equals: true } } }, orderBy: { lastReportedAt: 'desc' } }),
    prisma.hostContainer.findMany({ where: { isCurrent: true }, orderBy: { lastReportedAt: 'desc' } }),
    prisma.appLog.groupBy({ by: ['service'], where: { level: 'ERROR', timestamp: { gte: startOfToday } }, _count: { _all: true } }),
    prisma.alert.findMany({ where: { status: { not: '已解决' }, isSuppressed: false }, orderBy: { updatedAt: 'desc' }, take: 5 }),
    // 扩展统计
    prisma.batchJob.findMany({ select: { status: true } }),
    prisma.selfHealingRule.findMany({ select: { enabled: true } }),
    prisma.logMonitorRule.findMany({ select: { id: true } }),
    // 最近活动
    prisma.batchJob.findMany({ orderBy: { startedAt: 'desc' }, take: 5, include: { targets: true } }),
    prisma.selfHealingExecution.findMany({ orderBy: { createdAt: 'desc' }, take: 5 }),
  ])

  const onlineHosts = hosts.filter((host) => host.status === '在线').length
  const hostOnlineRate = hosts.length ? (onlineHosts / hosts.length) * 100 : 100
  const avgCpu = avg(hosts.map((host) => host.cpu))
  const avgMemory = avg(hosts.map((host) => host.memory))
  const avgDisk = avg(hosts.map((host) => host.disk))
  const resourceScore = clampScore(100 - Math.max(avgCpu, avgMemory, avgDisk))
  const alertScore = clampScore(100 - activeAlerts * 8)
  const errorCountByService = Object.fromEntries(errorLogs.map((row) => [row.service, row._count._all]))

  const serviceRows = [
    ...hostServices.map((service) => ({ name: service.name, status: service.status, lastReportedAt: service.lastReportedAt })),
    ...hostContainers.map((container) => ({ name: container.name, status: container.state, lastReportedAt: container.lastReportedAt })),
  ]
  const servicesByName = new Map<string, typeof serviceRows>()
  for (const service of serviceRows) {
    const list = servicesByName.get(service.name) ?? []
    list.push(service)
    servicesByName.set(service.name, list)
  }

  const services = Array.from(servicesByName.entries()).map(([name, rows]) => {
    const errors = errorCountByService[name] ?? 0
    return {
      key: name,
      name,
      status: serviceStatus(rows.map((row) => row.status), errors),
      instances: rows.length,
      qps: 0,
      errorRate: errors ? `${errors} 条错误` : '0%',
    }
  }).sort((left, right) => right.instances - left.instances || left.name.localeCompare(right.name)).slice(0, 8)

  const reportedServiceCount = serviceRows.length
  const abnormalServiceCount = serviceRows.filter((service) => serviceStatus([service.status], errorCountByService[service.name] ?? 0) === '异常').length
  const warningServiceCount = serviceRows.filter((service) => serviceStatus([service.status], errorCountByService[service.name] ?? 0) === '警告').length
  const serviceHealthRate = reportedServiceCount ? ((reportedServiceCount - abnormalServiceCount - warningServiceCount * 0.5) / reportedServiceCount) * 100 : 100
  const healthValue = clampScore(hostOnlineRate * 0.3 + serviceHealthRate * 0.25 + resourceScore * 0.25 + alertScore * 0.2)

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
      { key: 'health', title: '系统健康度', value: percent(healthValue), trend: '主机30% / 服务容器25% / 资源25% / 告警20%', trendType: healthValue >= 90 ? 'up' : 'danger', color: healthValue >= 90 ? '#52c41a' : '#ff4d4f' },
      { key: 'alerts', title: '今日告警', value: todayAlerts, trend: `未解决 ${activeAlerts} 条`, trendType: activeAlerts ? 'danger' : 'down', color: '#ff4d4f' },
      { key: 'services', title: '上报服务', value: reportedServiceCount, trend: `${abnormalServiceCount} 个异常 / ${warningServiceCount} 个警告`, trendType: abnormalServiceCount ? 'danger' : 'up', color: '#faad14' },
      { key: 'availability', title: '可用性', value: percent(hostOnlineRate, 2), trend: `${onlineHosts}/${hosts.length || 0} 主机在线`, trendType: hostOnlineRate >= 90 ? 'up' : 'danger', color: '#1677ff' },
      { key: 'batchJobs', title: '批处理任务', value: batchJobs.length, trend: `${batchSuccess} 成功 / ${batchFailed} 失败`, trendType: batchFailed ? 'danger' : 'up', color: '#722ed1' },
    ],
    resources: [
      { name: 'CPU 使用率', value: avgCpu, status: avgCpu > 85 ? 'exception' : 'active' },
      { name: '内存使用率', value: avgMemory, status: avgMemory > 85 ? 'exception' : 'normal' },
      { name: '磁盘使用率', value: avgDisk, status: avgDisk > 85 ? 'exception' : 'normal' },
    ],
    services,
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
