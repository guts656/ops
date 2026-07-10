import type { AgentJobStatus, AgentJobTransport, AgentJobType, HostAction, OsType } from '../types/host'
import { prisma } from '../db/prisma'
import { runSshCommand } from '../remote/ssh'
import type { RemoteConnectionInput } from '../remote/types'
import { runWinrmCommand } from '../remote/winrm'
import { buildHostAuditHashChain, createHostAudit } from '../utils/audit'

export type ServiceControlAction = 'start' | 'stop' | 'restart'

export interface ServiceControlHost {
  id: string
  ip: string
  hostname: string
  os: OsType
}

export interface ServiceControlCredential {
  sshUsername: string
  authType: '密码' | '密钥'
  password?: string
  privateKey?: string
  sshPort: number
}

export interface ServiceControlService {
  id: string
  name: string
  source: string
  pid?: number | null
}

export interface ServiceControlResult {
  success: boolean
  summary: string
  stdout: string
  stderr: string
  jobId: string
  hostId: string
  serviceId: string
  serviceName: string
  action: ServiceControlAction
}

function transportFor(os: OsType): AgentJobTransport {
  return os === 'Windows' ? 'winrm' : 'ssh'
}

function psSingle(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function shSingle(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`
}

function serviceJobType(action: ServiceControlAction): AgentJobType {
  if (action === 'start') return 'start_service'
  if (action === 'stop') return 'stop_service'
  return 'restart_service'
}

function serviceAuditAction(action: ServiceControlAction): HostAction {
  if (action === 'start') return '启动服务'
  if (action === 'stop') return '停止服务'
  return '重启服务'
}

function actionText(action: ServiceControlAction) {
  if (action === 'start') return '启动'
  if (action === 'stop') return '停止'
  return '重启'
}

export function buildServiceConnection(host: ServiceControlHost, credentials: ServiceControlCredential): RemoteConnectionInput {
  return {
    host: host.ip,
    port: credentials.sshPort,
    username: credentials.sshUsername,
    authType: credentials.authType,
    password: credentials.password,
    privateKey: credentials.privateKey,
    os: host.os,
  }
}

export function assertSupportedServiceCredential(host: ServiceControlHost, credentials: ServiceControlCredential) {
  if (host.os === 'Windows' && credentials.authType !== '密码') throw new Error('Windows WinRM 当前仅支持密码认证')
}

export function assertControllableService(service: { name: string; source: string }, host: ServiceControlHost) {
  if (!service.name.trim()) throw new Error('服务名称不能为空')
  if (host.os === 'Windows') {
    if (service.source && service.source !== 'windows-service') throw new Error('仅支持控制 Windows 服务')
    return
  }
  if (service.source && service.source !== 'systemd') throw new Error('仅支持控制 systemd 服务')
}

export function serviceControlCommand(host: ServiceControlHost, serviceName: string, action: ServiceControlAction) {
  if (host.os === 'Windows') {
    if (action === 'restart') {
      return `$serviceName = ${psSingle(serviceName)}
try {
  $svc = Get-Service -Name $serviceName -ErrorAction Stop
  if ($svc.Status -eq 'Running') {
    Stop-Service -Name $serviceName -ErrorAction Stop
    $svc.WaitForStatus('Stopped', [TimeSpan]::FromSeconds(30))
    $svc.Refresh()
  }
  Start-Service -Name $serviceName -ErrorAction Stop
  $svc.WaitForStatus('Running', [TimeSpan]::FromSeconds(30))
  $svc.Refresh()
  Write-Output "STATUS=$($svc.Status)"
  if ($svc.Status -ne 'Running') { throw "服务执行后状态为 $($svc.Status)，未达到 Running" }
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

  const command = action === 'restart' ? 'systemctl restart' : action === 'start' ? 'systemctl start' : 'systemctl stop'
  return `set -e\n${command} ${shSingle(serviceName)}\nprintf 'STATUS=%s\\n' "$(systemctl is-active ${shSingle(serviceName)} || true)"`
}

async function appendAudit(operator: string, action: HostAction, target: string, result: '成功' | '失败' = '成功', detail = '') {
  const existing = await prisma.hostAuditLog.findMany({ orderBy: { createdAt: 'asc' } })
  const normalized = existing.map((log) => ({
    id: log.id,
    time: log.time,
    operator: log.operator,
    action: log.action as HostAction,
    target: log.target,
    result: log.result as '成功' | '失败',
    detail: log.detail,
    retentionUntil: log.retentionUntil,
  }))
  const chain = buildHostAuditHashChain([...normalized, createHostAudit(operator, action, target, result, detail)])
  const next = chain[chain.length - 1]
  await prisma.hostAuditLog.create({ data: next })
}

async function createAgentJob(host: ServiceControlHost, type: AgentJobType, operator: string) {
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
  return value.replace(/\0/g, '')
}

async function finishAgentJob(id: string, status: AgentJobStatus, summary: string, stdout = '', stderr = '') {
  return prisma.hostAgentJob.update({
    where: { id },
    data: { status, summary: dbSafeText(summary), stdout: dbSafeText(stdout), stderr: dbSafeText(stderr), completedAt: new Date() },
  })
}

export async function executeHostServiceControl(input: {
  host: ServiceControlHost
  service: ServiceControlService
  connection: RemoteConnectionInput
  operator: string
  action: ServiceControlAction
  source?: string
}) {
  const { host, service, connection, operator, action } = input
  assertControllableService(service, host)
  const job = await createAgentJob(host, serviceJobType(action), operator)
  try {
    const command = serviceControlCommand(host, service.name, action)
    const result = host.os === 'Windows' ? await runWinrmCommand(connection, command) : await runSshCommand(connection, command)
    await finishAgentJob(job.id, result.success ? 'success' : 'failed', result.summary, result.stdout, result.stderr)
    const nextStatus = action === 'stop' ? 'stopped' : host.os === 'Windows' ? 'Running' : 'active'
    if (result.success) {
      await prisma.hostService.update({ where: { id: service.id }, data: { status: nextStatus, pid: action === 'stop' ? null : service.pid, lastReportedAt: new Date() } })
      await prisma.serviceEvent.create({
        data: {
          hostId: host.id,
          service: service.name,
          eventType: action === 'start' ? 'service_start_requested' : action === 'stop' ? 'service_stop_requested' : 'service_restart_requested',
          level: action === 'stop' ? 'WARN' : 'INFO',
          message: `${operator} requested ${action} for ${service.name}`,
          occurredAt: new Date(),
          source: input.source ?? 'ops-platform',
          payload: { serviceId: service.id, action, result: result.summary, agentJobId: job.id },
        },
      })
    }
    await appendAudit(operator, serviceAuditAction(action), host.hostname, result.success ? '成功' : '失败', `${service.name}：${result.summary}`)
    return {
      success: result.success,
      summary: result.summary,
      stdout: result.stdout,
      stderr: result.stderr,
      jobId: job.id,
      hostId: host.id,
      serviceId: service.id,
      serviceName: service.name,
      action,
    } satisfies ServiceControlResult
  } catch (error) {
    const message = error instanceof Error ? error.message : `服务${actionText(action)}命令执行异常`
    await finishAgentJob(job.id, 'failed', `服务${actionText(action)}异常：${message}`, '', message)
    await appendAudit(operator, serviceAuditAction(action), host.hostname, '失败', `${service.name}：${message}`)
    throw error
  }
}
