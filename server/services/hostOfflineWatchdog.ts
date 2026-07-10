import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { resolveAlert } from '../data/alerts'
import { isHostInMaintenance } from '../data/hosts'
import { ingestAlert } from './alertIngestionService'
import { shanghaiTime } from '../utils/time'

const DEFAULT_CHECK_INTERVAL_SECONDS = 60
const DEFAULT_OFFLINE_THRESHOLD_MINUTES = 5
const DEFAULT_NEW_HOST_GRACE_MINUTES = 5

let watchdogTimer: NodeJS.Timeout | undefined

function enabled() {
  return process.env.HOST_OFFLINE_WATCHDOG_ENABLED !== 'false'
}

function positiveNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function checkIntervalMs() {
  return positiveNumber(process.env.HOST_OFFLINE_CHECK_INTERVAL_SECONDS, DEFAULT_CHECK_INTERVAL_SECONDS) * 1000
}

function offlineThresholdMs() {
  return positiveNumber(process.env.HOST_OFFLINE_THRESHOLD_MINUTES, DEFAULT_OFFLINE_THRESHOLD_MINUTES) * 60_000
}

function newHostGraceMs() {
  return positiveNumber(process.env.HOST_OFFLINE_GRACE_MINUTES, DEFAULT_NEW_HOST_GRACE_MINUTES) * 60_000
}

function hostOfflineFingerprint(hostId: string) {
  return `host-offline:${hostId}`
}

function parseHeartbeat(value: string | null | undefined) {
  if (!value) return undefined
  const direct = new Date(value)
  if (!Number.isNaN(direct.getTime())) return direct
  const normalized = value.replace(/\//g, '-').replace(' ', 'T')
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function latestDate(values: Array<Date | null | undefined>) {
  return values.filter((value): value is Date => Boolean(value)).sort((a, b) => b.getTime() - a.getTime())[0]
}

async function resolveHostOfflineAlert(host: { id: string; hostname: string; ip: string }, now: Date) {
  const alert = await prisma.alert.findFirst({ where: { fingerprint: hostOfflineFingerprint(host.id), status: { not: '已解决' } }, orderBy: { updatedAt: 'desc' } })
  if (!alert) return false
  const metadata = alert.metadata && typeof alert.metadata === 'object' && !Array.isArray(alert.metadata) ? alert.metadata as Record<string, unknown> : {}
  await prisma.alert.update({
    where: { id: alert.id },
    data: {
      metadata: {
        ...metadata,
        recoveredAfterResolve: true,
        recovery: { hostId: host.id, hostIp: host.ip, hostname: host.hostname, recoveredAt: now.toISOString(), reason: 'heartbeat_resumed' },
      } as Prisma.InputJsonValue,
    },
  })
  await resolveAlert(alert.id, 'Agent在线监控')
  return true
}

export async function evaluateHostOfflineWatchdog(now = new Date(), options: { hostIds?: string[] } = {}) {
  if (!enabled()) return { checked: 0, alerted: 0, resolved: 0, skipped: 0 }
  const thresholdMs = offlineThresholdMs()
  const graceMs = newHostGraceMs()
  const hosts = await prisma.host.findMany({
    where: { id: options.hostIds?.length ? { in: options.hostIds } : undefined, agentStatus: { not: '未安装' } },
    select: { id: true, ip: true, hostname: true, owner: true, status: true, agentStatus: true, lastHeartbeat: true, lastMetricAt: true, agentInstalledAt: true, createdAt: true },
  })
  let alerted = 0
  let resolved = 0
  let skipped = 0

  for (const host of hosts) {
    if (host.status === '纳管中' || host.agentStatus === '安装中') {
      skipped += 1
      continue
    }
    if (await isHostInMaintenance(host.id, now)) {
      skipped += 1
      continue
    }

    const heartbeatAt = parseHeartbeat(host.lastHeartbeat)
    const installedAt = parseHeartbeat(host.agentInstalledAt)
    const freshAt = latestDate([host.lastMetricAt, heartbeatAt])
    const baseAt = latestDate([freshAt, installedAt, host.createdAt]) ?? host.createdAt
    const ageMs = now.getTime() - baseAt.getTime()
    const withinGrace = now.getTime() - host.createdAt.getTime() < graceMs || (installedAt && now.getTime() - installedAt.getTime() < graceMs)

    if (freshAt && ageMs <= thresholdMs) {
      if (await resolveHostOfflineAlert(host, now)) resolved += 1
      continue
    }
    if (withinGrace) {
      skipped += 1
      continue
    }

    const minutes = Math.max(1, Math.round(ageMs / 60_000))
    await prisma.host.update({ where: { id: host.id }, data: { status: '离线', agentStatus: '异常' } })
    const result = await ingestAlert({
      source: 'Agent在线监控',
      level: '严重',
      service: host.hostname,
      title: `主机离线：${host.hostname}`,
      content: `主机 ${host.ip} · ${host.hostname} 已超过 ${minutes} 分钟未上报 Agent 心跳或指标，可能是 Agent 停止、主机离线或网络异常。`,
      owner: host.owner || 'Agent在线监控',
      relatedType: 'host',
      relatedId: host.id,
      fingerprint: hostOfflineFingerprint(host.id),
      metadata: {
        hostId: host.id,
        hostIp: host.ip,
        hostname: host.hostname,
        lastHeartbeat: host.lastHeartbeat,
        lastMetricAt: host.lastMetricAt?.toISOString(),
        thresholdMinutes: Math.round(thresholdMs / 60_000),
        staleMinutes: minutes,
        checkedAt: now.toISOString(),
      },
    })
    if (result.alert) alerted += 1
  }

  return { checked: hosts.length, alerted, resolved, skipped }
}

export function startHostOfflineWatchdog() {
  if (!enabled()) return undefined
  if (watchdogTimer) return watchdogTimer
  const run = () => {
    evaluateHostOfflineWatchdog().catch((error) => console.error('Host offline watchdog failed:', error))
  }
  watchdogTimer = setInterval(run, checkIntervalMs())
  watchdogTimer.unref?.()
  run()
  return watchdogTimer
}
