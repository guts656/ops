import { prisma } from '../db/prisma.ts'
import { ingestAlert } from './alertIngestionService.ts'
import { startOfShanghaiTodayUtc } from '../data/logs.ts'
import { shanghaiTime } from '../utils/time.ts'

function watchdogMinutes() {
  const value = Number(process.env.AGENT_LOG_UPLOAD_WATCHDOG_MINUTES || 15)
  return Number.isFinite(value) && value > 0 ? value : 15
}

function staleMinutes() {
  const value = Number(process.env.AGENT_LOG_STALE_ALERT_MINUTES || 10)
  return Number.isFinite(value) && value > 0 ? value : 10
}

function fingerprint(hostId: string, kind: string) {
  return `agent-log-upload:${kind}:${hostId}`
}

function parseHeartbeat(value: string | null) {
  if (!value) return undefined
  const normalized = value.trim().replace(/\//g, '-')
  const localMatch = normalized.match(/^(\d{4}-\d{1,2}-\d{1,2})\s+(\d{1,2}:\d{2}:\d{2})$/)
  const parsed = localMatch ? new Date(`${localMatch[1]}T${localMatch[2]}+08:00`) : new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? undefined : parsed
}

async function createLogUploadAlert(input: {
  hostId: string
  hostName: string
  hostIp: string
  title: string
  content: string
  kind: string
  metadata?: Record<string, unknown>
}) {
  return ingestAlert({
    level: '严重',
    source: 'Agent日志上传',
    service: input.hostName || input.hostIp,
    title: input.title,
    content: input.content,
    owner: '系统',
    time: shanghaiTime(new Date()),
    fingerprint: fingerprint(input.hostId, input.kind),
    relatedType: 'host',
    relatedId: input.hostId,
    metadata: { hostId: input.hostId, sourceHostId: input.hostId, hostIp: input.hostIp, hostName: input.hostName, ...input.metadata },
  })
}

export async function alertAgentLogUploadFailure(hostId: string, reason: string, metadata?: Record<string, unknown>) {
  const host = await prisma.host.findUnique({ where: { id: hostId }, select: { id: true, ip: true, hostname: true } })
  if (!host) return undefined
  return createLogUploadAlert({
    hostId,
    hostName: host.hostname,
    hostIp: host.ip,
    kind: 'upload-failed',
    title: 'Agent 日志上传失败',
    content: `${host.hostname || host.ip} 日志上传失败：${reason}`,
    metadata,
  })
}

export async function checkAgentLogUploadWatchdog() {
  const now = new Date()
  const since = new Date(now.getTime() - staleMinutes() * 60_000)
  const shanghaiToday = startOfShanghaiTodayUtc(now)
  const rules = await prisma.logCollectionRule.findMany({ where: { enabled: true } })
  const hostIds = new Set<string>()
  const groups = new Set<string>()

  for (const rule of rules) {
    if (rule.scope === 'host' && rule.hostId) hostIds.add(rule.hostId)
    if (rule.scope === 'group' && rule.hostGroup) groups.add(rule.hostGroup)
  }
  if (!hostIds.size && !groups.size) return { checked: 0, alerted: 0 }

  const hosts = await prisma.host.findMany({
    where: {
      status: '在线',
      OR: [
        hostIds.size ? { id: { in: Array.from(hostIds) } } : undefined,
        groups.size ? { group: { in: Array.from(groups) } } : undefined,
      ].filter(Boolean) as any,
    },
    select: { id: true, ip: true, hostname: true, lastHeartbeat: true },
  })

  let alerted = 0
  for (const host of hosts) {
    const lastHeartbeat = parseHeartbeat(host.lastHeartbeat)
    if (lastHeartbeat && lastHeartbeat < since) continue
    const count = await prisma.appLog.count({ where: { hostId: host.id, timestamp: { gte: shanghaiToday } } })
    if (count > 0) continue
    await createLogUploadAlert({
      hostId: host.id,
      hostName: host.hostname,
      hostIp: host.ip,
      kind: 'no-logs-today',
      title: 'Agent 日志长期未入库',
      content: `${host.hostname || host.ip} 已配置日志采集，但北京时间今天没有任何日志入库，请检查 Agent 计划任务、日志路径和上传接口。`,
      metadata: { since: shanghaiToday.toISOString(), lastHeartbeat: lastHeartbeat ? shanghaiTime(lastHeartbeat) : host.lastHeartbeat || undefined },
    })
    alerted += 1
  }
  return { checked: hosts.length, alerted }
}

export function startAgentLogUploadWatchdog() {
  const run = () => {
    checkAgentLogUploadWatchdog().catch((error) => console.error('Agent log upload watchdog failed:', error))
  }
  setTimeout(run, 30_000)
  setInterval(run, watchdogMinutes() * 60_000)
}
