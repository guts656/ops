import { networkInterfaces } from 'node:os'
import type { Prisma } from '../../src/generated/prisma/client'
import type { AddHostFormValues, AgentBackendDiagnosisResult, AgentJob, AgentJobStatus, AgentJobTransport, AgentJobType, EditHostValues, Host, HostAuditLog, HostFilters, HostResourcePoint } from '../types/host'
import { buildHostAuditHashChain, createHostAudit } from '../utils/audit.ts'
import { generateAgentToken, hashAgentToken } from '../utils/agentToken.ts'
import { decryptSecret, encryptSecret } from '../utils/credentialCrypto.ts'
import { AGENT_VERSION, buildWindowsOfflineAgentInstaller, collectRemoteMetrics, diagnoseRemoteAgentBackends, installRemoteAgent, repairRemoteAgentBackendRoutes, restartRemoteAgent, testRemoteConnection } from '../remote/agentInstaller.ts'
import { runSshCommand } from '../remote/ssh.ts'
import type { AgentOperationResult, RemoteConnectionInput } from '../remote/types'
import { runWinrmCommand } from '../remote/winrm.ts'
import { prisma } from '../db/prisma.ts'
import { executeHostServiceControl } from '../services/hostServiceControl.ts'
import { shanghaiTime } from '../utils/time.ts'
import { signOfflineAgentInstallerToken, verifyOfflineAgentInstallerToken } from '../utils/offlineAgentInstallerToken.ts'
import { getLinuxSshPrivateKey } from '../utils/linuxSshKey.ts'
import { evaluateHostResourceMonitorRulesForHost } from './hostResourceMonitorRules.ts'
import { normalizeMarketType } from '../utils/tradingSessions.ts'
import { resolveAlert } from './alerts.ts'

export const hostGroups = ['核心交易区', '支付专区', '风控专区', 'DCORE OFFICE', '测试资源池']
export const hostTags = ['生产', '数据库', '中间件', '支付', '风控', 'Windows', 'Linux', '高可用', '批处理']

type HostRow = NonNullable<Awaited<ReturnType<typeof prisma.host.findFirst>>> & { pullCredential?: HostPullCredentialRow | null }
type HostAuditRow = NonNullable<Awaited<ReturnType<typeof prisma.hostAuditLog.findFirst>>>
type HostAgentJobRow = NonNullable<Awaited<ReturnType<typeof prisma.hostAgentJob.findFirst>>>
type HostPullCredentialRow = NonNullable<Awaited<ReturnType<typeof prisma.hostPullCredential.findFirst>>>
type ServiceControlAction = 'start' | 'stop' | 'restart'

type HostConnectionValues = {
  sshUsername: string
  authType: NonNullable<AddHostFormValues['authType']>
  password?: string
  privateKey?: string
  sshPort: number
}
type HostMaintenanceValues = { enabled: boolean; reason?: string; until?: string }
type AgentInstallOverrides = { apiBaseUrl?: string }
const PLATFORM_LINUX_SSH_KEY_REF = '__OPS_PLATFORM_LINUX_SSH_KEY__'

function trend(seed: number): HostResourcePoint[] {
  return Array.from({ length: 24 }, (_, index) => {
    const hour = String(index).padStart(2, '0')
    return {
      time: `${hour}:00`,
      cpu: Math.min(96, Math.max(8, seed + Math.round(Math.sin(index / 2) * 13) + (index % 5) * 2)),
      memory: Math.min(98, Math.max(18, seed + 18 + Math.round(Math.cos(index / 3) * 9))),
      disk: Math.min(99, Math.max(22, seed + 28 + Math.round(index / 3))),
    }
  })
}

function nowText() {
  return shanghaiTime(new Date())
}

function metricRetentionPoints() {
  return Math.max(24, Number(process.env.OPS_AGENT_METRICS_RETENTION_POINTS || 288))
}

function metricRetentionDays() {
  return Math.max(1, Number(process.env.OPS_AGENT_METRICS_RETENTION_DAYS || 14))
}

function metricRetentionCutoff(now = new Date()) {
  return new Date(now.getTime() - metricRetentionDays() * 24 * 60 * 60 * 1000)
}

function normalizeAgentBaseUrl(value: string) {
  const url = new URL(value)
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Agent 后端地址仅支持 http/https')
  return url.origin
}

function isLikelyVirtualIpv4(address: string) {
  return address.startsWith('169.254.')
    || address.startsWith('172.17.')
    || address.startsWith('172.18.')
    || address.startsWith('172.19.')
}

function localIpv4Urls() {
  const port = process.env.PORT || 3001
  const urls: string[] = []
  for (const values of Object.values(networkInterfaces())) {
    for (const item of values ?? []) {
      if (item.family === 'IPv4' && !item.internal && !isLikelyVirtualIpv4(item.address)) urls.push(`http://${item.address}:${port}`)
    }
  }
  return urls
}

function agentPublicUrl() {
  const candidates = agentBackendCandidates()
  if (!candidates.length) throw new Error('未找到可用于 Agent 回连的后端地址，请配置 OPS_AGENT_PUBLIC_URL')
  return candidates[0]
}

function agentBackendCandidates() {
  const candidates = [
    process.env.OPS_AGENT_PUBLIC_URL,
    ...localIpv4Urls(),
  ].filter(Boolean) as string[]
  return Array.from(new Set(candidates.map((candidate) => normalizeAgentBaseUrl(candidate))))
}

function agentIntervalSeconds() {
  return Math.max(10, Number(process.env.OPS_AGENT_METRICS_INTERVAL_SECONDS || 60))
}

function metricTime(date: Date) {
  return date.toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })
}

function isValidPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}

function clampPercent(value: number) {
  return Math.min(100, Math.max(0, Math.round(value)))
}

function isoText(date: Date) {
  return date.toISOString()
}

function transportFor(os: Host['os']): AgentJobTransport {
  return os === 'Windows' ? 'winrm' : 'ssh'
}

function toPullCredentialStatus(credential?: HostPullCredentialRow | null): Host['pullCredential'] {
  if (!credential) return undefined
  return {
    enabled: credential.enabled,
    sshUsername: credential.sshUsername,
    authType: credential.authType as HostConnectionValues['authType'],
    sshPort: credential.sshPort,
    intervalSeconds: credential.intervalSeconds,
    lastPulledAt: credential.lastPulledAt ? isoText(credential.lastPulledAt) : undefined,
    lastError: credential.lastError || undefined,
    updatedAt: isoText(credential.updatedAt),
  }
}

function maintenanceOf(host: HostRow): Host['maintenance'] {
  const active = Boolean(host.maintenanceEnabled && (!host.maintenanceUntil || host.maintenanceUntil > new Date()))
  return {
    enabled: host.maintenanceEnabled,
    active,
    reason: host.maintenanceReason || undefined,
    until: host.maintenanceUntil ? isoText(host.maintenanceUntil) : undefined,
    startedAt: host.maintenanceStartedAt ? isoText(host.maintenanceStartedAt) : undefined,
    operator: host.maintenanceOperator || undefined,
  }
}

function toHost(host: HostRow | null): Host | undefined {
  if (!host) return undefined
  return {
    id: host.id,
    ip: host.ip,
    hostname: host.hostname,
    os: host.os as Host['os'],
    osVersion: host.osVersion,
    cpu: host.cpu,
    memory: host.memory,
    disk: host.disk,
    status: host.status as Host['status'],
    group: host.group,
    marketType: normalizeMarketType(host.marketType),
    tags: host.tags,
    agentVersion: host.agentVersion,
    agentStatus: host.agentStatus as Host['agentStatus'],
    agentInstalledAt: host.agentInstalledAt,
    lastHeartbeat: host.lastHeartbeat,
    sshPort: host.sshPort,
    owner: host.owner,
    changeNo: host.changeNo,
    uptimeSeconds: host.uptimeSeconds ?? undefined,
    maintenance: maintenanceOf(host),
    pullCredential: toPullCredentialStatus(host.pullCredential),
  }
}

function toAuditLog(log: HostAuditRow | null): HostAuditLog | undefined {
  if (!log) return undefined
  return {
    id: log.id,
    time: log.time,
    operator: log.operator,
    action: log.action as HostAuditLog['action'],
    target: log.target,
    result: log.result as HostAuditLog['result'],
    detail: log.detail,
    previousHash: log.previousHash,
    hash: log.hash,
    retentionUntil: log.retentionUntil,
  }
}

function toAgentJob(job: HostAgentJobRow): AgentJob {
  return {
    id: job.id,
    hostId: job.hostId,
    type: job.type as AgentJobType,
    transport: job.transport as AgentJobTransport,
    status: job.status as AgentJobStatus,
    operator: job.operator,
    startedAt: shanghaiTime(job.startedAt),
    completedAt: job.completedAt ? shanghaiTime(job.completedAt) : undefined,
    summary: job.summary,
    stdout: job.stdout,
    stderr: job.stderr,
  }
}

function buildConnection(host: Host, credentials: HostConnectionValues): RemoteConnectionInput {
  return {
    host: host.ip,
    port: credentials.sshPort,
    username: credentials.sshUsername,
    authType: credentials.authType,
    password: credentials.password,
    privateKey: resolvePrivateKey(credentials),
    os: host.os,
  }
}

function resolvePrivateKey(credentials: HostConnectionValues) {
  return credentials.authType === '密钥' && credentials.privateKey === PLATFORM_LINUX_SSH_KEY_REF ? getLinuxSshPrivateKey() : credentials.privateKey
}

function credentialSecret(credentials: HostConnectionValues) {
  const secret = credentials.authType === '密码' ? credentials.password : credentials.privateKey
  if (!secret) throw new Error(credentials.authType === '密码' ? '请输入密码' : '请输入 SSH 私钥')
  return secret
}

const INSTALL_TIMEOUT_MS = 180000
const WINDOWS_INSTALL_TIMEOUT_MS = 180000
const SELF_UPDATE_MIN_AGENT_VERSION = 'v2.10.8'
const WINDOWS_SELF_UPDATE_MIN_AGENT_VERSION = 'v2.10.11'
const AGENT_UPDATE_RUNNING_TIMEOUT_MS = Math.max(10 * 60 * 1000, Number(process.env.OPS_AGENT_UPDATE_RUNNING_TIMEOUT_MS || 10 * 60 * 1000))

function transportName(os: Host['os']) {
  return os === 'Windows' ? 'WinRM' : 'SSH'
}

function parseAgentVersion(version: string) {
  const match = version.match(/^v?(\d+)\.(\d+)\.(\d+)$/)
  return match ? match.slice(1).map((part) => Number(part)) : undefined
}

function isAgentVersionAtLeast(version: string, minimum: string) {
  const current = parseAgentVersion(version)
  const target = parseAgentVersion(minimum)
  if (!current || !target) return false
  for (let index = 0; index < target.length; index += 1) {
    if (current[index] > target[index]) return true
    if (current[index] < target[index]) return false
  }
  return true
}

function agentUpdateTimeoutMinutes() {
  return Math.ceil(AGENT_UPDATE_RUNNING_TIMEOUT_MS / 60000)
}

function installModeFor(values: AddHostFormValues, os: Host['os']) {
  if (values.installMode === 'offline') {
    if (os !== 'Windows') throw new Error('离线安装模式仅支持 Windows 主机')
    return 'offline'
  }
  return 'remote'
}

function requireRemoteCredentials(values: AddHostFormValues | Partial<AddHostFormValues>, os: Host['os']): HostConnectionValues {
  const sshUsername = values.sshUsername || (os === 'Linux' ? 'root' : undefined)
  const authType = values.authType || (os === 'Linux' ? '密钥' : undefined)
  const sshPort = values.sshPort || (os === 'Linux' ? 22 : undefined)
  if (!sshUsername || !authType || !sshPort) throw new Error('请填写远程用户名、认证方式和端口')
  if (os === 'Windows' && authType !== '密码') throw new Error('Windows WinRM 当前仅支持密码认证')
  if (authType === '密码' && !values.password) throw new Error('请输入密码')
  if (authType === '密钥' && os === 'Windows') throw new Error('Windows 当前请使用离线 Agent 安装，不再支持密钥远程纳管')
  if (authType === '密钥' && os === 'Linux' && !values.privateKey) getLinuxSshPrivateKey()
  if (authType === '密钥' && os !== 'Linux' && !values.privateKey) throw new Error('请输入 SSH 私钥')
  return {
    sshUsername,
    authType,
    password: values.password,
    privateKey: authType === '密钥' ? (values.privateKey || PLATFORM_LINUX_SSH_KEY_REF) : undefined,
    sshPort,
  }
}

function buildInstallConnection(host: Host, credentials: HostConnectionValues): RemoteConnectionInput {
  const connection = buildConnection(host, credentials)
  return { ...connection, timeoutMs: host.os === 'Windows' ? WINDOWS_INSTALL_TIMEOUT_MS : INSTALL_TIMEOUT_MS }
}

function installJobBaseSummary(host: Host, type: 'install_agent' | 'reinstall_agent', result: AgentOperationResult) {
  if (host.os === 'Windows' && result.timedOut) {
    const seconds = Math.max(1, Math.round((result.timeoutMs ?? WINDOWS_INSTALL_TIMEOUT_MS) / 1000))
    const action = type === 'reinstall_agent' ? '重装' : '安装'
    return `Windows Agent ${action}等待超时（${seconds} 秒），但远端安装脚本可能仍在继续执行；请登录主机检查计划任务 OpsPlatformAgent 是否已创建/运行，并确认 C:\\ProgramData\\OpsPlatformAgent 下脚本与状态文件。`
  }
  return result.summary
}

function installJobSummary(host: Host, type: 'install_agent' | 'reinstall_agent', result: AgentOperationResult) {
  return `${installJobBaseSummary(host, type, result)} · installer=${host.os === 'Windows' ? 'ops-platform-agent.ps1' : 'linux-agent'}`
}

function psSingle(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function shSingle(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function serviceControlCommand(host: Host, serviceName: string, action: 'start' | 'stop') {
  if (host.os === 'Windows') {
    const targetStatus = action === 'start' ? 'Running' : 'Stopped'
    const verb = action === 'start' ? 'Start-Service' : 'Stop-Service'
    return `$serviceName = ${psSingle(serviceName)}
$targetStatus = ${psSingle(targetStatus)}
try {
  $svc = Get-Service -Name $serviceName -ErrorAction Stop
  if ($svc.Status -ne $targetStatus) {
    ${verb} -Name $serviceName -ErrorAction Stop
    $svc.WaitForStatus($targetStatus, [TimeSpan]::FromSeconds(30))
  }
  $svc.Refresh()
  Write-Output "STATUS=$($svc.Status)"
  if ($svc.Status -ne $targetStatus) { throw "服务执行后状态为 $($svc.Status)，未达到 $targetStatus" }
} catch {
  $recent = Get-WinEvent -FilterHashtable @{ LogName = 'System'; ProviderName = 'Service Control Manager'; StartTime = (Get-Date).AddMinutes(-10) } -MaxEvents 20 -ErrorAction SilentlyContinue |
    Where-Object { $_.Message -like "*$serviceName*" } |
    Select-Object -First 3 -ExpandProperty Message
  if ($recent) {
    throw "$($_.Exception.Message)\`n最近服务控制日志:\`n$($recent -join "\`n---\`n")"
  }
  throw
}`
  }
  return `set -e\n${action === 'start' ? 'systemctl start' : 'systemctl stop'} ${shSingle(serviceName)}\nprintf 'STATUS=%s\\n' \"$(systemctl is-active ${shSingle(serviceName)} || true)\"`
}

function assertControllableService(service: { name: string; source: string }, host: Host) {
  if (!service.name.trim()) throw new Error('服务名称不能为空')
  if (host.os === 'Windows') {
    if (service.source && service.source !== 'windows-service') throw new Error('仅支持控制 Windows 服务')
    return
  }
  if (service.source && service.source !== 'systemd') throw new Error('仅支持控制 systemd 服务')
}

function assertSupportedCredential(host: Host, credentials: HostConnectionValues) {
  if (host.os === 'Windows' && credentials.authType !== '密码') throw new Error('Windows WinRM 当前仅支持密码认证')
}

function decryptPullCredential(credential: HostPullCredentialRow): HostConnectionValues {
  const secret = decryptSecret(credential)
  return {
    sshUsername: credential.sshUsername,
    authType: credential.authType as HostConnectionValues['authType'],
    sshPort: credential.sshPort,
    password: credential.authType === '密码' ? secret : undefined,
    privateKey: credential.authType === '密钥' ? secret : undefined,
  }
}

function isPullDue(credential: HostPullCredentialRow, now: Date) {
  if (!credential.lastPulledAt) return true
  return now.getTime() - credential.lastPulledAt.getTime() >= credential.intervalSeconds * 1000
}

async function appendAudit(operator: string, action: Parameters<typeof createHostAudit>[1], target: string, result: '成功' | '失败' = '成功', detail = '') {
  const existing = await getHostAuditLogs()
  const chain = buildHostAuditHashChain([...existing.map(({ previousHash, hash, ...log }) => log), createHostAudit(operator, action, target, result, detail)])
  const next = chain[chain.length - 1]
  await prisma.hostAuditLog.create({ data: next })
}

function metadataObject(value: unknown) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function hostServiceAlertFingerprint(hostId: string, serviceName: string, port?: number | null) {
  return `agent-service:${hostId}:${serviceName}:${port ?? 0}:abnormal`
}

function serviceControlJobType(action: ServiceControlAction): AgentJobType {
  if (action === 'start') return 'start_service'
  if (action === 'stop') return 'stop_service'
  return 'restart_service'
}

function serviceControlAuditAction(action: ServiceControlAction): Parameters<typeof createHostAudit>[1] {
  if (action === 'start') return '启动服务'
  if (action === 'stop') return '停止服务'
  return '重启服务'
}

function serviceControlText(action: ServiceControlAction) {
  if (action === 'start') return '启动'
  if (action === 'stop') return '停止'
  return '重启'
}

async function createAgentJob(host: Host, type: AgentJobType, operator: string) {
  return prisma.hostAgentJob.create({
    data: {
      id: `agent-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      hostId: host.id,
      type,
      transport: transportFor(host.os),
      status: 'running',
      operator,
      summary: '任务执行中',
    },
  })
}

function dbSafeText(value: string) {
  return value.replace(/ /g, '')
}

async function finishAgentJob(id: string, status: AgentJobStatus, summary: string, stdout = '', stderr = '') {
  return prisma.hostAgentJob.update({
    where: { id },
    data: { status, summary: dbSafeText(summary), stdout: dbSafeText(stdout), stderr: dbSafeText(stderr), completedAt: new Date() },
  })
}

async function recordFailedAgentJob(host: Host, type: AgentJobType, operator: string, summary: string, stderr = '') {
  const job = await createAgentJob(host, type, operator)
  await finishAgentJob(job.id, 'failed', summary, '', stderr || summary)
}

async function upsertPullCredential(host: Host, credentials: HostConnectionValues) {
  assertSupportedCredential(host, credentials)
  const encrypted = encryptSecret(credentialSecret(credentials))
  await prisma.hostPullCredential.upsert({
    where: { hostId: host.id },
    create: {
      hostId: host.id,
      sshUsername: credentials.sshUsername,
      authType: credentials.authType,
      sshPort: credentials.sshPort,
      intervalSeconds: 30,
      enabled: true,
      ...encrypted,
    },
    update: {
      sshUsername: credentials.sshUsername,
      authType: credentials.authType,
      sshPort: credentials.sshPort,
      intervalSeconds: 30,
      enabled: true,
      lastError: null,
      ...encrypted,
    },
  })
  await prisma.host.update({ where: { id: host.id }, data: { sshPort: credentials.sshPort, owner: credentials.sshUsername } })
}

async function runInstallJob(host: Host, credentials: HostConnectionValues, operator: string, type: 'install_agent' | 'reinstall_agent', overrides: AgentInstallOverrides = {}) {
  const job = await createAgentJob(host, type, operator)
  assertSupportedCredential(host, credentials)
  const currentAuth = await prisma.host.findUnique({ where: { id: host.id }, select: { agentTokenHash: true, agentTokenVersion: true } })
  const token = generateAgentToken()
  await prisma.host.update({ where: { id: host.id }, data: { agentTokenHash: hashAgentToken(token), agentTokenVersion: { increment: 1 } } })
  const result = await installRemoteAgent(buildInstallConnection(host, credentials), { hostId: host.id, agentToken: token, apiBaseUrl: overrides.apiBaseUrl ? normalizeAgentBaseUrl(overrides.apiBaseUrl) : agentPublicUrl(), intervalSeconds: agentIntervalSeconds() })
  if (!result.success && currentAuth?.agentTokenHash) {
    await prisma.host.update({ where: { id: host.id }, data: { agentTokenHash: currentAuth.agentTokenHash, agentTokenVersion: currentAuth.agentTokenVersion } })
  }
  const status = result.status === 'success' ? 'success' : 'failed'
  const summary = installJobSummary(host, type, result)
  await finishAgentJob(job.id, status, summary, result.stdout, result.stderr)
  const now = nowText()
  const updated = await prisma.host.update({
    where: { id: host.id },
    data: result.success
      ? { status: '在线', agentStatus: '正常', agentVersion: AGENT_VERSION, agentInstalledAt: now, lastHeartbeat: now, sshPort: credentials.sshPort, owner: credentials.sshUsername }
      : { status: '纳管中', agentStatus: '异常', agentVersion: AGENT_VERSION, lastHeartbeat: now, sshPort: credentials.sshPort, owner: credentials.sshUsername },
  })
  await appendAudit(operator, type === 'install_agent' ? '新增主机' : '重新安装Agent', updated.hostname, result.success ? '成功' : '失败', installJobBaseSummary(host, type, result))
  return toHost(updated)!
}

export async function queryHosts(filters: HostFilters) {
  const keyword = filters.keyword?.trim()
  const hosts = await prisma.host.findMany({
    where: {
      status: filters.status,
      group: filters.group,
      tags: filters.tag ? { has: filters.tag } : undefined,
      OR: keyword ? [{ ip: { contains: keyword } }, { hostname: { contains: keyword, mode: 'insensitive' } }] : undefined,
    },
    include: { pullCredential: true },
    orderBy: { createdAt: 'desc' },
  })
  return hosts.map((host) => toHost(host)!)
}

export async function getHost(id: string) {
  return toHost(await prisma.host.findUnique({ where: { id }, include: { pullCredential: true } }))
}

export async function isHostInMaintenance(hostId: string, now = new Date()) {
  const host = await prisma.host.findUnique({ where: { id: hostId }, select: { maintenanceEnabled: true, maintenanceUntil: true } })
  return Boolean(host?.maintenanceEnabled && (!host.maintenanceUntil || host.maintenanceUntil > now))
}

export async function setHostMaintenance(id: string, values: HostMaintenanceValues, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  if (values.enabled) {
    const reason = values.reason?.trim()
    if (!reason) throw new Error('请输入维护原因')
    const until = values.until ? new Date(values.until) : null
    if (until && until <= new Date()) throw new Error('维护结束时间必须晚于当前时间')
    const updated = await prisma.host.update({ where: { id }, data: { maintenanceEnabled: true, maintenanceReason: reason, maintenanceUntil: until, maintenanceStartedAt: new Date(), maintenanceOperator: operator } })
    await appendAudit(operator, '进入维护', updated.hostname, '成功', until ? `${reason}；截止 ${until.toLocaleString('zh-CN', { hour12: false })}` : `${reason}；手动结束`)
    return getHost(id)
  }
  const updated = await prisma.host.update({ where: { id }, data: { maintenanceEnabled: false, maintenanceReason: null, maintenanceUntil: null, maintenanceStartedAt: null, maintenanceOperator: operator } })
  await appendAudit(operator, '退出维护', updated.hostname, '成功', '恢复主机告警')
  return getHost(id)
}

export async function getHostOptions() {
  const hosts = await prisma.host.findMany({ select: { group: true, tags: true } })
  const groups = Array.from(new Set([...hostGroups, ...hosts.map((host) => host.group).filter(Boolean)])).sort()
  const tags = Array.from(new Set([...hostTags, ...hosts.flatMap((host) => host.tags).filter(Boolean)])).sort()
  return { groups, tags }
}

export async function getHostAuditLogs() {
  const logs = await prisma.hostAuditLog.findMany({ orderBy: { createdAt: 'asc' } })
  return logs.map((log) => toAuditLog(log)!)
}

export async function getHostAgentJobs(id: string) {
  const jobs = await prisma.hostAgentJob.findMany({ where: { hostId: id }, orderBy: { createdAt: 'desc' } })
  return jobs.map(toAgentJob)
}

export async function getHostResourceTrend(id: string) {
  const points = await prisma.hostResourcePoint.findMany({ where: { hostId: id }, orderBy: { sampledAt: 'desc' }, take: metricRetentionPoints() })
  return points.reverse().map(({ time, cpu, memory, disk }) => ({ time, cpu, memory, disk }))
}

async function markHostOffline(hostId: string, reason?: string) {
  await prisma.host.update({ where: { id: hostId }, data: { status: '离线', agentStatus: '异常', uptimeSeconds: null } })
  if (reason) {
    await prisma.hostPullCredential.updateMany({ where: { hostId }, data: { lastPulledAt: new Date(), lastError: reason } })
  }
}

async function recordPullError(hostId: string, reason: string) {
  await prisma.hostPullCredential.updateMany({ where: { hostId }, data: { lastPulledAt: new Date(), lastError: reason } })
}

export async function recordHostMetrics(hostId: string, values: { cpu: number; memory: number; disk: number; hostname?: string; osVersion?: string; uptimeSeconds?: number; sampledAt?: Date }) {
  const sampledAt = values.sampledAt ?? new Date()
  const cpu = clampPercent(values.cpu)
  const memory = clampPercent(values.memory)
  const disk = clampPercent(values.disk)
  const now = nowText()
  const host = await prisma.$transaction(async (tx) => {
    const updated = await tx.host.update({
      where: { id: hostId },
      data: {
        cpu,
        memory,
        disk,
        hostname: values.hostname,
        osVersion: values.osVersion,
        uptimeSeconds: values.uptimeSeconds,
        status: '在线',
        agentStatus: '正常',
        lastHeartbeat: now,
        lastMetricAt: sampledAt,
      },
    })
    await tx.hostResourcePoint.create({ data: { hostId, time: metricTime(sampledAt), sampledAt, cpu, memory, disk } })
    await tx.hostResourcePoint.deleteMany({ where: { hostId, sampledAt: { lt: metricRetentionCutoff(sampledAt) } } })
    return updated
  })
  evaluateHostResourceMonitorRulesForHost(hostId, sampledAt).catch((error) => {
    console.error('Host resource monitor evaluation failed:', error)
  })
  return toHost(host)!
}

export async function testHostConnection(values: Partial<AddHostFormValues>, operator: string) {
  const firstIp = values.ips?.split('\n').map((ip) => ip.trim()).filter(Boolean)[0]
  if (!firstIp) {
    return { success: false, hostname: '', os: values.os ?? 'Linux', message: '请填写主机 IP、用户名、认证方式和端口' }
  }
  const os = values.os ?? 'Linux'
  let credentials: HostConnectionValues
  try {
    credentials = requireRemoteCredentials(values, os)
  } catch (error) {
    return { success: false, hostname: '', os, message: error instanceof Error ? error.message : '请填写主机 IP、用户名、认证方式和端口' }
  }
  const result = await testRemoteConnection({
    host: firstIp,
    port: credentials.sshPort,
    username: credentials.sshUsername,
    authType: credentials.authType,
    password: credentials.password,
    privateKey: resolvePrivateKey(credentials),
    os,
  })
  await appendAudit(operator, '测试连接', firstIp, result.success ? '成功' : '失败', result.summary)
  return {
    success: result.success,
    hostname: result.hostname || values.hostname || `host-${firstIp.split('.').join('-')}`,
    os,
    osVersion: result.osVersion,
    message: result.success ? result.summary : `${result.summary}${result.stderr ? `：${result.stderr}` : ''}`,
  }
}

export async function addHosts(values: AddHostFormValues, operator: string) {
  const ips = values.ips.split('\n').map((ip) => ip.trim()).filter(Boolean)
  const now = nowText()
  const createdHosts: Host[] = []
  const repeatedIps = ips.filter((ip, index) => ips.indexOf(ip) !== index)
  if (repeatedIps.length) throw new Error(`提交内容包含重复 IP：${Array.from(new Set(repeatedIps)).join('、')}`)
  const existingHosts = await prisma.host.findMany({ where: { ip: { in: ips } }, select: { ip: true, hostname: true } })
  if (existingHosts.length) throw new Error(`以下 IP 已存在，不能重复纳管：${existingHosts.map((host) => `${host.ip}(${host.hostname})`).join('、')}`)

  for (const [index, ip] of ips.entries()) {
    const os = values.os ?? 'Linux'
    const installMode = installModeFor(values, os)
    const credentials = installMode === 'remote' ? requireRemoteCredentials(values, os) : undefined
    const sshPort = credentials?.sshPort ?? (os === 'Windows' ? 5985 : 22)
    const host = await prisma.host.create({
      data: {
        id: `host-${Date.now()}-${index}`,
        ip,
        hostname: ips.length === 1 && values.hostname ? values.hostname : `host-${ip.split('.').join('-')}`,
        os,
        osVersion: values.osVersion || (os === 'Windows' ? 'Windows Server' : 'Linux'),
        cpu: 0,
        memory: 0,
        disk: 0,
        status: '纳管中',
        group: values.group,
        tags: values.tags ?? [],
        agentVersion: AGENT_VERSION,
        agentStatus: '安装中',
        agentInstalledAt: now,
        lastHeartbeat: now,
        sshPort,
        owner: credentials?.sshUsername ?? '',
        changeNo: values.changeNo || '',
      },
    })
    const hostItem = toHost(host)!
    if (credentials) {
      void runInstallJob(hostItem, credentials, operator, 'install_agent').catch(async (error) => {
        const message = error instanceof Error ? error.message : 'Agent 安装失败'
        await prisma.host.update({ where: { id: hostItem.id }, data: { status: '纳管中', agentStatus: '异常', lastHeartbeat: nowText() } }).catch(() => undefined)
        await recordFailedAgentJob(hostItem, 'install_agent', operator, `Agent 安装异常：${message}`, message).catch(() => undefined)
        await appendAudit(operator, '新增主机', hostItem.hostname, '失败', `主机已保存，但 Agent 安装失败：${message}`).catch(() => undefined)
      })
    } else {
      await appendAudit(operator, '新增主机', hostItem.hostname, '成功', 'Windows 主机已保存为离线 Agent 安装模式，未保存 WinRM 密码；请下载离线安装脚本并在目标主机以管理员身份执行')
    }
    createdHosts.push((await getHost(host.id)) ?? hostItem)
  }

  return createdHosts
}

export async function updateHost(id: string, values: EditHostValues, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  const updated = await prisma.host.update({
    where: { id },
    data: {
      hostname: values.hostname,
      os: values.os,
      osVersion: values.osVersion,
      sshPort: values.sshPort,
      group: values.group,
      tags: values.tags,
    },
  })
  await appendAudit(operator, '编辑主机', updated.hostname, '成功', '更新主机基础信息')
  return toHost(updated)
}

export async function deleteHost(id: string, operator: string) {
  const deleted = await getHost(id)
  if (!deleted) return undefined
  await prisma.host.delete({ where: { id } })
  await appendAudit(operator, '删除主机', deleted.hostname, '成功', '二次确认后删除主机，审计日志保留')
  return deleted
}

export async function remanageHost(id: string, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  const updated = await prisma.host.update({
    where: { id },
    data: { status: '纳管中', agentStatus: '安装中', lastHeartbeat: nowText() },
  })
  await appendAudit(operator, '重新纳管', updated.hostname, '成功', '主机进入纳管中状态，请重新安装 Agent')
  return toHost(updated)
}

export async function pullHostMetrics(id: string, credentials: HostConnectionValues, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  assertSupportedCredential(current, credentials)
  const transport = transportName(current.os)
  const job = await createAgentJob(current, 'pull_host_metrics', operator)
  const result = await collectRemoteMetrics(buildConnection(current, credentials))
  if (!result.success || result.cpu === undefined || result.memory === undefined || result.disk === undefined) {
    await finishAgentJob(job.id, 'failed', result.summary, result.stdout, result.stderr)
    await markHostOffline(id, result.summary)
    await appendAudit(operator, '拉取主机指标', current.hostname, '失败', result.summary)
    return getHost(id)
  }

  const updated = await recordHostMetrics(id, { cpu: result.cpu, memory: result.memory, disk: result.disk, hostname: result.hostname, osVersion: result.osVersion, uptimeSeconds: result.uptimeSeconds })
  await prisma.host.update({ where: { id }, data: { sshPort: credentials.sshPort, owner: credentials.sshUsername } })
  await finishAgentJob(job.id, 'success', `${transport} 拉取指标成功：CPU ${result.cpu}%，内存 ${result.memory}%，磁盘 ${result.disk}%`, result.stdout, result.stderr)
  await appendAudit(operator, '拉取主机指标', updated.hostname, '成功', `CPU ${result.cpu}%，内存 ${result.memory}%，磁盘 ${result.disk}%`)
  return getHost(id)
}

export async function saveHostPullCredential(id: string, credentials: HostConnectionValues, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  await upsertPullCredential(current, credentials)
  await appendAudit(operator, '启用自动Pull', current.hostname, '成功', `已启用 30 秒 ${transportName(current.os)} 自动 Pull 指标`)
  return getHost(id)
}

export async function disableHostPullCredential(id: string, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  await prisma.hostPullCredential.updateMany({ where: { hostId: id }, data: { enabled: false } })
  await appendAudit(operator, '停用自动Pull', current.hostname, '成功', '已停用自动 Pull 指标')
  return getHost(id)
}

export async function runDueHostPullMetrics() {
  const now = new Date()
  const credentials = await prisma.hostPullCredential.findMany({ where: { enabled: true }, include: { host: { include: { pullCredential: true } } } })
  for (const credential of credentials) {
    if (!isPullDue(credential, now)) continue
    const host = toHost(credential.host)
    if (!host) continue

    try {
      const values = decryptPullCredential(credential)
      const result = await collectRemoteMetrics(buildConnection(host, values))
      if (!result.success) {
        await recordPullError(host.id, result.summary)
        continue
      }
      if (!isValidPercent(result.cpu) || !isValidPercent(result.memory) || !isValidPercent(result.disk)) {
        await recordPullError(host.id, `自动 Pull 指标无效：CPU=${String(result.cpu)}，内存=${String(result.memory)}，磁盘=${String(result.disk)}`)
        continue
      }

      await recordHostMetrics(host.id, { cpu: result.cpu, memory: result.memory, disk: result.disk, hostname: result.hostname, osVersion: result.osVersion, uptimeSeconds: result.uptimeSeconds, sampledAt: now })
      await prisma.hostPullCredential.update({ where: { id: credential.id }, data: { lastPulledAt: now, lastError: null } })
    } catch (error) {
      await recordPullError(host.id, error instanceof Error ? error.message : '自动 Pull 执行失败')
    }
  }
}

export async function refreshHostInfo(id: string, credentials: HostConnectionValues, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  assertSupportedCredential(current, credentials)
  const job = await createAgentJob(current, 'refresh_host_info', operator)
  const result = await testRemoteConnection(buildConnection(current, credentials))
  await finishAgentJob(job.id, result.success ? 'success' : 'failed', result.success ? '系统信息重新检测成功' : result.summary, result.stdout, result.stderr)

  if (!result.success) {
    await markHostOffline(id, result.summary)
    await appendAudit(operator, '刷新主机信息', current.hostname, '失败', result.summary)
    return getHost(id)
  }

  const now = nowText()
  const updated = await prisma.host.update({
    where: { id },
    data: {
      hostname: result.hostname || current.hostname,
      osVersion: result.osVersion || current.osVersion,
      status: '在线',
      lastHeartbeat: now,
      sshPort: credentials.sshPort,
      owner: credentials.sshUsername,
    },
  })
  await appendAudit(operator, '刷新主机信息', updated.hostname, '成功', `系统版本 ${current.osVersion} -> ${updated.osVersion}`)
  return toHost(updated)
}

export async function diagnoseAgentBackend(id: string, credentials: HostConnectionValues, operator: string): Promise<AgentBackendDiagnosisResult | undefined> {
  const current = await getHost(id)
  if (!current) return undefined
  assertSupportedCredential(current, credentials)
  const job = await createAgentJob(current, 'diagnose_agent_backend', operator)
  const result = await diagnoseRemoteAgentBackends(buildConnection(current, credentials), agentBackendCandidates())
  const recommendedUrl = result.candidates.find((candidate) => candidate.reachable)?.baseUrl
  const summary = recommendedUrl ? `推荐使用 ${recommendedUrl}` : '候选后端地址均无法从该主机访问'
  await finishAgentJob(job.id, recommendedUrl ? 'success' : 'failed', summary, JSON.stringify(result.candidates, null, 2), result.success ? '' : result.stderr)
  await appendAudit(operator, '诊断Agent回连', current.hostname, recommendedUrl ? '成功' : '失败', summary)
  return { candidates: result.candidates, recommendedUrl }
}

export async function repairAgentBackendRoutes(id: string, credentials: HostConnectionValues, operator: string): Promise<AgentBackendDiagnosisResult | undefined> {
  const current = await getHost(id)
  if (!current) return undefined
  if (current.os === 'Windows') {
    await appendAudit(operator, '修复Agent回连路由', current.hostname, '失败', 'Windows Agent 回连路由修复暂未开放')
    throw new Error('Windows Agent 回连路由修复暂未开放')
  }

  const candidates = agentBackendCandidates()
  const job = await createAgentJob(current, 'repair_agent_backend_routes', operator)
  const repair = await repairRemoteAgentBackendRoutes(buildConnection(current, credentials), candidates)
  if (!repair.success) {
    await finishAgentJob(job.id, 'failed', repair.summary, repair.stdout, repair.stderr)
    await appendAudit(operator, '修复Agent回连路由', current.hostname, '失败', repair.summary)
    return { candidates: [] }
  }

  const diagnosis = await diagnoseRemoteAgentBackends(buildConnection(current, credentials), candidates)
  const recommendedUrl = diagnosis.candidates.find((candidate) => candidate.reachable)?.baseUrl
  const summary = recommendedUrl ? `路由修复后推荐使用 ${recommendedUrl}` : '已尝试修复路由，但候选后端地址仍不可达'
  await finishAgentJob(job.id, recommendedUrl ? 'success' : 'failed', summary, JSON.stringify(diagnosis.candidates, null, 2), repair.stderr || diagnosis.stderr)
  await appendAudit(operator, '修复Agent回连路由', current.hostname, recommendedUrl ? '成功' : '失败', summary)
  return { candidates: diagnosis.candidates, recommendedUrl }
}

export async function createWindowsOfflineAgentPackage(id: string, operator: string, overrides: AgentInstallOverrides = {}) {
  const current = await getHost(id)
  if (!current) return undefined
  if (current.os !== 'Windows') throw new Error('离线 Agent 安装脚本仅支持 Windows 主机')

  const apiBaseUrl = overrides.apiBaseUrl ? normalizeAgentBaseUrl(overrides.apiBaseUrl) : agentPublicUrl()
  const installerToken = signOfflineAgentInstallerToken({ hostId: current.id, hostIp: current.ip, apiBaseUrl })
  const installer = buildWindowsOfflineAgentInstaller(current.ip, {
    hostId: current.id,
    installerToken,
    apiBaseUrl,
    intervalSeconds: agentIntervalSeconds(),
  })
  await appendAudit(operator, '生成离线Agent包', current.hostname, '成功', `已生成 Windows 离线 Agent 安装脚本；下载本身不会轮换现有 Agent Token，脚本执行时才会登记`)
  return installer
}

export async function enrollWindowsOfflineAgent(id: string, installerToken: string) {
  const payload = verifyOfflineAgentInstallerToken(installerToken)
  if (payload.hostId !== id) throw new Error('离线 Agent 安装令牌与主机不匹配')

  const current = await getHost(id)
  if (!current) return undefined
  if (current.os !== 'Windows') throw new Error('离线 Agent 安装仅支持 Windows 主机')
  if (current.ip !== payload.hostIp) throw new Error('离线 Agent 安装令牌与主机 IP 不匹配')

  const token = generateAgentToken()
  const now = nowText()
  const updated = await prisma.host.update({
    where: { id },
    data: {
      status: '纳管中',
      agentStatus: '安装中',
      agentVersion: AGENT_VERSION,
      lastHeartbeat: now,
      agentTokenHash: hashAgentToken(token),
      agentTokenVersion: { increment: 1 },
    },
  })
  await appendAudit('Windows离线安装脚本', '生成离线Agent包', updated.hostname, '成功', '目标主机已执行离线安装脚本并登记 Agent Token')
  return { agentToken: token }
}

export async function reinstallAgent(id: string, credentials: HostConnectionValues, operator: string, overrides: AgentInstallOverrides = {}) {
  const current = await getHost(id)
  if (!current) return undefined
  await prisma.host.update({ where: { id }, data: { status: '纳管中', agentStatus: '安装中', lastHeartbeat: nowText() } })
  try {
    return await runInstallJob(current, credentials, operator, 'reinstall_agent', overrides)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent 安装失败'
    const updated = await prisma.host.update({ where: { id }, data: { status: '纳管中', agentStatus: '异常', lastHeartbeat: nowText(), sshPort: credentials.sshPort, owner: credentials.sshUsername } })
    await recordFailedAgentJob(current, 'reinstall_agent', operator, `Agent 安装异常：${message}`, message)
    await appendAudit(operator, '重新安装Agent', current.hostname, '失败', message)
    return toHost(updated)
  }
}

export async function restartAgent(id: string, credentials: HostConnectionValues, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  assertSupportedCredential(current, credentials)
  const job = await createAgentJob(current, 'restart_agent', operator)
  const result = await restartRemoteAgent(buildConnection(current, credentials))
  const status = result.status === 'success' ? 'success' : 'failed'
  await finishAgentJob(job.id, status, result.summary, result.stdout, result.stderr)
  const now = nowText()
  const updated = await prisma.host.update({
    where: { id },
    data: result.success
      ? { status: '在线', agentStatus: '正常', lastHeartbeat: now, sshPort: credentials.sshPort, owner: credentials.sshUsername }
      : { agentStatus: '异常', lastHeartbeat: now, sshPort: credentials.sshPort, owner: credentials.sshUsername },
  })
  await appendAudit(operator, '重启Agent', updated.hostname, result.success ? '成功' : '失败', result.summary)
  return toHost(updated)
}

export async function recoverStaleAgentUpdateJobs(hostIds?: string[], now = new Date()) {
  const normalizedHostIds = hostIds?.filter(Boolean)
  const cutoff = new Date(now.getTime() - AGENT_UPDATE_RUNNING_TIMEOUT_MS)
  const staleJobs = await prisma.hostAgentJob.findMany({
    where: {
      hostId: normalizedHostIds?.length ? { in: normalizedHostIds } : undefined,
      type: 'update_agent',
      status: 'running',
      updatedAt: { lt: cutoff },
    },
    select: { id: true, hostId: true, updatedAt: true },
  })
  if (!staleJobs.length) return []

  const minutes = agentUpdateTimeoutMinutes()
  await prisma.hostAgentJob.updateMany({
    where: { id: { in: staleJobs.map((job) => job.id) }, status: 'running' },
    data: {
      status: 'failed',
      completedAt: now,
      summary: `Agent 更新超时，旧 Agent 未回传结果（超过 ${minutes} 分钟）`,
      stderr: `Agent update job timed out after ${minutes} minutes without result callback.`,
    },
  })
  return staleJobs
}

export async function queueAgentUpdateJobs(values: { hostIds?: string[]; os?: 'Linux' | 'Windows'; onlyOutdated?: boolean }, operator: string) {
  const hostIds = values.hostIds?.filter(Boolean)
  const onlyOutdated = values.onlyOutdated !== false
  const hosts = await prisma.host.findMany({
    where: {
      id: hostIds?.length ? { in: hostIds } : undefined,
      os: values.os,
    },
    select: { id: true, ip: true, hostname: true, os: true, status: true, agentStatus: true, agentVersion: true, agentTokenHash: true },
    orderBy: { ip: 'asc' },
  })
  if (hosts.length > 0) await recoverStaleAgentUpdateJobs(hosts.map((host) => host.id))
  const existingJobs = await prisma.hostAgentJob.findMany({
    where: { hostId: { in: hosts.map((host) => host.id) }, type: 'update_agent', status: { in: ['pending', 'running'] } },
    select: { hostId: true },
  })
  const busyHostIds = new Set(existingJobs.map((job) => job.hostId))
  const queued: Array<{ hostId: string; ip: string; hostname: string; version: string }> = []
  const skipped: Array<{ hostId: string; ip: string; hostname: string; reason: string }> = []

  for (const host of hosts) {
    if (!host.agentTokenHash) {
      skipped.push({ hostId: host.id, ip: host.ip, hostname: host.hostname, reason: 'Agent Token 不存在，需要先安装 Agent' })
      continue
    }
    if (host.status !== '在线' || host.agentStatus !== '正常') {
      skipped.push({ hostId: host.id, ip: host.ip, hostname: host.hostname, reason: '主机或 Agent 未在线' })
      continue
    }
    if (onlyOutdated && host.agentVersion === AGENT_VERSION) {
      skipped.push({ hostId: host.id, ip: host.ip, hostname: host.hostname, reason: `已是当前版本 ${AGENT_VERSION}` })
      continue
    }
    const minimumVersion = host.os === 'Windows' ? WINDOWS_SELF_UPDATE_MIN_AGENT_VERSION : SELF_UPDATE_MIN_AGENT_VERSION
    if (!isAgentVersionAtLeast(host.agentVersion, minimumVersion)) {
      skipped.push({ hostId: host.id, ip: host.ip, hostname: host.hostname, reason: `当前 Agent ${host.agentVersion || '-'} 不支持可靠自更新，需要先手动/离线升级到 ${minimumVersion}` })
      continue
    }
    if (busyHostIds.has(host.id)) {
      skipped.push({ hostId: host.id, ip: host.ip, hostname: host.hostname, reason: '已有更新任务在队列中' })
      continue
    }
    await prisma.hostAgentJob.create({
      data: {
        id: `agent-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
        hostId: host.id,
        type: 'update_agent',
        transport: 'agent',
        status: 'pending',
        operator,
        summary: `等待 Agent 自更新到 ${AGENT_VERSION}`,
        stdout: JSON.stringify({ targetVersion: AGENT_VERSION }),
      },
    })
    await appendAudit(operator, '更新Agent', host.hostname, '成功', `已下发 Agent 自更新任务：${host.agentVersion || '-'} -> ${AGENT_VERSION}`)
    queued.push({ hostId: host.id, ip: host.ip, hostname: host.hostname, version: host.agentVersion })
  }

  return { targetVersion: AGENT_VERSION, queued, skipped }
}

async function queueWindowsAgentServiceControl(current: Host, service: { id: string; name: string }, operator: string, action: ServiceControlAction) {
  await prisma.hostAgentJob.create({
    data: {
      id: `agent-job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      hostId: current.id,
      type: serviceControlJobType(action),
      transport: 'agent',
      status: 'pending',
      operator,
      summary: `等待 Windows Agent ${serviceControlText(action)}服务：${service.name}`,
      stdout: JSON.stringify({ action, serviceId: service.id, serviceName: service.name }),
    },
  })
  await appendAudit(operator, serviceControlAuditAction(action), current.hostname, '成功', `已下发 Windows Agent ${serviceControlText(action)}服务任务：${service.name}`)
}

async function controlHostService(id: string, serviceId: string, credentials: Partial<HostConnectionValues> | undefined, operator: string, action: ServiceControlAction) {
  const current = await getHost(id)
  if (!current) return undefined
  const service = await prisma.hostService.findFirst({ where: { id: serviceId, hostId: id } })
  if (!service) throw new Error('服务记录不存在')
  if (current.os === 'Windows') {
    await queueWindowsAgentServiceControl(current, service, operator, action)
    return getHost(id)
  }
  if (!credentials) throw new Error('请填写远程用户名、认证方式和端口')
  assertSupportedCredential(current, credentials as HostConnectionValues)
  await executeHostServiceControl({
    host: current,
    service,
    connection: buildConnection(current, credentials as HostConnectionValues),
    operator,
    action,
    source: 'ops-platform',
  })
  return getHost(id)
}

export async function startHostService(id: string, serviceId: string, credentials: Partial<HostConnectionValues> | undefined, operator: string) {
  return controlHostService(id, serviceId, credentials, operator, 'start')
}

export async function stopHostService(id: string, serviceId: string, credentials: Partial<HostConnectionValues> | undefined, operator: string) {
  return controlHostService(id, serviceId, credentials, operator, 'stop')
}

export async function restartHostService(id: string, serviceId: string, credentials: Partial<HostConnectionValues> | undefined, operator: string) {
  return controlHostService(id, serviceId, credentials, operator, 'restart')
}

export async function deleteHostServiceRecord(id: string, serviceId: string, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  const service = await prisma.hostService.findFirst({ where: { id: serviceId, hostId: id } })
  if (!service) throw new Error('服务记录不存在')
  await prisma.hostService.delete({ where: { id: service.id } })
  await appendAudit(operator, '删除服务记录', current.hostname, '成功', `仅删除平台服务记录：${service.name}，不会删除主机上的真实服务`)
  return getHost(id)
}

export async function ignoreHostServiceRecord(id: string, serviceId: string, operator: string) {
  const current = await getHost(id)
  if (!current) return undefined
  const service = await prisma.hostService.findFirst({ where: { id: serviceId, hostId: id } })
  if (!service) throw new Error('服务记录不存在')
  await prisma.hostService.update({
    where: { id: service.id },
    data: {
      metadata: {
        ...metadataObject(service.metadata),
        ignored: true,
        ignoredBy: operator,
        ignoredAt: new Date().toISOString(),
      } as Prisma.InputJsonValue,
    },
  })
  const alert = await prisma.alert.findFirst({
    where: { fingerprint: hostServiceAlertFingerprint(id, service.name, service.port), status: { not: '已解决' } },
    orderBy: { updatedAt: 'desc' },
  })
  if (alert) await resolveAlert(alert.id, 'Agent服务监控')
  await appendAudit(operator, '忽略服务', current.hostname, '成功', `已忽略平台服务记录：${service.name}；后续 Agent 上报同名服务不会展示或触发服务告警`)
  return getHost(id)
}
