import { Router } from 'express'
import { ZodError, z } from 'zod'
import { enrollWindowsOfflineAgent, recordHostMetrics } from '../data/hosts.ts'
import { ingestHostContainers } from '../data/hostContainers.ts'
import { ingestHostServices, ingestServiceEvents } from '../data/hostServices.ts'
import { completeWindowsBatchFileAgentResult } from '../data/batchJobs.ts'
import { getHostLogCollectionPaths } from '../data/logCollectionRules.ts'
import { upsertHostLogCollectionStatus } from '../data/logCollectionStatus.ts'
import { getAgentLocalLogMonitorConfig, ingestAgentLocalLogMonitorResults } from '../data/logMonitorRules.ts'
import { ingestAgentLogs } from '../data/logs.ts'
import { authenticateAgentHost, touchAgentHeartbeat } from '../utils/agentAuth.ts'
import { alertAgentLogUploadFailure } from '../services/agentLogUploadWatchdog.ts'
import { prisma } from '../db/prisma.ts'
import { AGENT_VERSION, buildAgentUpdatePackage } from '../remote/agentInstaller.ts'
import { shanghaiTime } from '../utils/time.ts'

const router = Router()
const AGENT_UPDATE_RUNNING_TIMEOUT_MS = Math.max(10 * 60 * 1000, Number(process.env.OPS_AGENT_UPDATE_RUNNING_TIMEOUT_MS || 10 * 60 * 1000))
const WINDOWS_SELF_UPDATE_MIN_AGENT_VERSION = 'v2.10.11'
const WINDOWS_NATIVE_SELF_UPDATE_MIN_AGENT_VERSION = 'v2.10.20'

const metricsSchema = z.object({
  cpu: z.coerce.number().min(0).max(100),
  memory: z.coerce.number().min(0).max(100),
  disk: z.coerce.number().min(0).max(100),
  hostname: z.string().min(1).optional(),
  osVersion: z.string().min(1).optional(),
  uptimeSeconds: z.coerce.number().int().min(0).optional(),
  sampledAt: z.string().datetime().optional(),
})

const logLevelSchema = z.enum(['ERROR', 'WARN', 'INFO', 'DEBUG'])
const logsSchema = z.object({
  logs: z.array(z.object({
    timestamp: z.string().datetime().optional(),
    service: z.coerce.string().min(1),
    level: z.preprocess((value) => typeof value === 'string' ? value.toUpperCase() : value, logLevelSchema),
    traceId: z.coerce.string().optional(),
    message: z.coerce.string().min(1),
    source: z.coerce.string().optional(),
    labels: z.unknown().optional(),
    rawPayload: z.unknown().optional(),
  })).min(1).max(100),
})
const logCollectionPathStatusSchema = z.object({
  path: z.coerce.string().min(1),
  expandedPath: z.coerce.string().optional(),
  exists: z.boolean().optional(),
  matchedFiles: z.coerce.number().int().min(0).optional(),
  readLines: z.coerce.number().int().min(0).optional(),
  uploadedLines: z.coerce.number().int().min(0).optional(),
  error: z.coerce.string().optional(),
  files: z.array(z.coerce.string()).max(20).optional(),
})
const logCollectionStatusSchema = z.object({
  collector: z.coerce.string().optional(),
  status: z.enum(['ok', 'warning', 'error']).optional(),
  sampledAt: z.string().datetime().optional(),
  configPaths: z.array(z.coerce.string()).max(50).optional(),
  matchedFiles: z.coerce.number().int().min(0).optional(),
  readLines: z.coerce.number().int().min(0).optional(),
  uploadedLines: z.coerce.number().int().min(0).optional(),
  eventLogs: z.coerce.number().int().min(0).optional(),
  lastError: z.coerce.string().optional(),
  paths: z.array(logCollectionPathStatusSchema).max(50).optional(),
  rawPayload: z.unknown().optional(),
})
const localLogMonitorMatchSchema = z.object({
  file: z.coerce.string().min(1).max(1024),
  lineNumber: z.coerce.number().int().min(1),
  line: z.coerce.string().max(2048),
  matchedKeywords: z.array(z.coerce.string().max(200)).max(20).optional(),
})
const localLogMonitorResultSchema = z.object({
  ruleId: z.coerce.string().min(1),
  matchedCount: z.coerce.number().int().min(0),
  matchedKeywords: z.array(z.coerce.string()).max(20).optional(),
  matchedSources: z.array(z.coerce.string()).max(20).optional(),
  matchedFiles: z.array(z.coerce.string()).max(20).optional(),
  matches: z.array(localLogMonitorMatchSchema).max(20).optional(),
  readLines: z.coerce.number().int().min(0).optional(),
  windowStart: z.string().datetime().optional(),
  windowEnd: z.string().datetime().optional(),
  lastError: z.coerce.string().optional(),
})
const localLogMonitorResultsSchema = z.object({
  sampledAt: z.string().datetime().optional(),
  mode: z.literal('local_monitor').optional(),
  rawLogUpload: z.literal(false).optional(),
  results: z.array(localLogMonitorResultSchema).max(200),
}).superRefine((value, context) => {
  const matches = value.results.flatMap((result) => result.matches ?? [])
  const evidenceCharacters = matches.reduce((total, match) => total + match.file.length + match.line.length + (match.matchedKeywords ?? []).join('').length, 0)
  if (matches.length > 200 || evidenceCharacters > 256 * 1024) {
    context.addIssue({ code: 'custom', message: '日志命中证据超过单次上报限制', path: ['results'] })
  }
})
const servicesSchema = z.object({
  services: z.array(z.object({
    name: z.string().min(1),
    status: z.string().min(1),
    port: z.coerce.number().int().min(0).max(65535).optional(),
    protocol: z.string().optional(),
    version: z.string().optional(),
    pid: z.coerce.number().int().min(0).optional(),
    source: z.string().optional(),
    metadata: z.unknown().optional(),
    lastReportedAt: z.string().datetime().optional(),
  })).min(1).max(200),
})
const serviceEventsSchema = z.object({
  events: z.array(z.object({
    service: z.string().min(1),
    eventType: z.string().min(1),
    level: z.string().min(1),
    message: z.string().min(1),
    occurredAt: z.string().datetime().optional(),
    source: z.string().optional(),
    payload: z.unknown().optional(),
  })).min(1).max(200),
})
const nullableNumberSchema = z.coerce.number().nullish()
const nullableIntSchema = z.coerce.number().int().nullish()
const nullableBytesSchema = z.union([z.string(), z.number()]).nullish()
const nullableDateTimeSchema = z.string().datetime().nullish()

const containersSchema = z.object({
  containers: z.array(z.object({
    containerId: z.string().min(1),
    name: z.string().min(1),
    image: z.string().min(1),
    status: z.string().min(1),
    state: z.string().min(1),
    restartCount: nullableIntSchema,
    ports: z.unknown().optional(),
    cpuPercent: nullableNumberSchema,
    memoryUsageBytes: nullableBytesSchema,
    memoryLimitBytes: nullableBytesSchema,
    memoryPercent: nullableNumberSchema,
    networkRxBytes: nullableBytesSchema,
    networkTxBytes: nullableBytesSchema,
    blockReadBytes: nullableBytesSchema,
    blockWriteBytes: nullableBytesSchema,
    labels: z.unknown().optional(),
    startedAt: nullableDateTimeSchema,
    lastReportedAt: nullableDateTimeSchema,
  })).max(300),
})
const offlineEnrollSchema = z.object({
  installerToken: z.string().min(1),
})
const agentJobResultSchema = z.object({
  action: z.enum(['start', 'stop', 'restart']),
  serviceId: z.string().min(1),
  serviceName: z.string().min(1),
  success: z.boolean(),
  summary: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
})
const batchScriptJobResultSchema = z.object({
  success: z.boolean(),
  summary: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  exitCode: z.coerce.number().int().optional(),
})
const batchFileJobResultSchema = batchScriptJobResultSchema.extend({
  remotePath: z.string().optional(),
  bytes: z.coerce.number().int().min(0).optional(),
  md5: z.string().regex(/^[a-fA-F0-9]{32}$/).optional(),
  preview: z.string().optional(),
  contentBase64: z.string().optional(),
})
const updateAgentJobResultSchema = z.object({
  success: z.boolean(),
  summary: z.string().optional(),
  stdout: z.string().optional(),
  stderr: z.string().optional(),
  version: z.string().optional(),
})

type BatchScriptPayload = {
  action?: 'run_script' | 'upload_file' | 'compare_file' | 'download_file'
  batchJobId?: string
  batchTargetId?: string
  scriptBase64?: string
  timeoutSeconds?: number
  targetDirectory?: string
  fileName?: string
  remotePath?: string
  fileContentBase64?: string
  expectedMd5?: string
  maxFileSize?: number
  persistArtifact?: boolean
}

function actionForJobType(type: string) {
  if (type === 'start_service') return 'start'
  if (type === 'stop_service') return 'stop'
  if (type === 'restart_service') return 'restart'
  return undefined
}

function statusForAction(action: 'start' | 'stop' | 'restart') {
  return action === 'stop' ? 'stopped' : 'Running'
}

async function refreshBatchJobStatus(batchJobId: string) {
  const targets = await prisma.batchJobTarget.findMany({ where: { jobId: batchJobId }, select: { status: true } })
  if (!targets.length) return
  const running = targets.filter((target) => target.status === 'running').length
  const success = targets.filter((target) => target.status === 'success').length
  const failed = targets.filter((target) => target.status === 'failed').length
  if (running > 0) {
    await prisma.batchJob.update({ where: { id: batchJobId }, data: { status: 'running', summary: `执行中：成功 ${success}，失败 ${failed}，等待 ${running}` } })
    return
  }
  const status = success === targets.length ? 'success' : success === 0 ? 'failed' : 'partial'
  await prisma.batchJob.update({ where: { id: batchJobId }, data: { status, completedAt: new Date(), summary: `完成 ${success}/${targets.length} 台主机，失败 ${failed}` } })
}

function parseBatchPayload(job: { stdout: string }) {
  try {
    return JSON.parse(job.stdout || '{}') as BatchScriptPayload
  } catch {
    return {}
  }
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

function buildLegacyWindowsSelfUpdateScript() {
  return `
$ErrorActionPreference = 'Continue'
$base = 'C:/ProgramData/OpsPlatformAgent'
$configPath = Join-Path $base 'agent-config.json'
$scriptPath = Join-Path $base 'ops-platform-agent.ps1'
$tempPath = Join-Path $base 'ops-platform-agent.ps1.new'
$updaterPath = Join-Path $base 'ops-platform-agent-updater.ps1'
$targetVersion = '${AGENT_VERSION}'
function Is-Blank($value) {
  if ($null -eq $value) { return $true }
  return ([string]$value).Trim().Length -eq 0
}
function Read-Utf8($path) {
  return [System.IO.File]::ReadAllText($path, [Text.Encoding]::UTF8)
}
function Get-JsonString($raw, $name) {
  $pattern = '"' + [regex]::Escape($name) + '"\\s*:\\s*"([^"]*)"'
  $match = [regex]::Match([string]$raw, $pattern)
  if ($match.Success) { return $match.Groups[1].Value }
  return ''
}
function Invoke-OpsGet($apiBaseUrl, $agentToken, $path) {
  $request = [System.Net.HttpWebRequest]::Create("$apiBaseUrl$path")
  $request.Method = 'GET'
  $request.Timeout = 10000
  $request.ReadWriteTimeout = 10000
  $request.KeepAlive = $false
  $request.Proxy = $null
  $request.Headers.Set('Authorization', "Bearer $agentToken")
  $response = $request.GetResponse()
  try {
    $reader = New-Object System.IO.StreamReader($response.GetResponseStream(), [Text.Encoding]::UTF8)
    try { return $reader.ReadToEnd() } finally { $reader.Close() }
  } finally { $response.Close() }
}
try {
  $configRaw = Read-Utf8 $configPath
  $hostId = Get-JsonString $configRaw 'hostId'
  $agentToken = Get-JsonString $configRaw 'agentToken'
  $apiBaseUrl = Get-JsonString $configRaw 'apiBaseUrl'
  if (Is-Blank $hostId) { throw 'missing hostId' }
  if (Is-Blank $agentToken) { throw 'missing agentToken' }
  if (Is-Blank $apiBaseUrl) { throw 'missing apiBaseUrl' }
  $packageRaw = Invoke-OpsGet $apiBaseUrl $agentToken "/api/agent/hosts/$hostId/update-package?os=Windows"
  $packageVersion = Get-JsonString $packageRaw 'version'
  if (-not (Is-Blank $packageVersion)) { $targetVersion = $packageVersion }
  $scriptBase64 = Get-JsonString $packageRaw 'scriptBase64'
  if (Is-Blank $scriptBase64) { throw 'missing update package script' }
  $scriptText = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($scriptBase64))
  if ($scriptText.IndexOf('OPS_AGENT_SELF_UPDATE_MARKER') -lt 0) { throw 'update package validation failed' }
  [System.IO.File]::WriteAllText($tempPath, $scriptText, [Text.Encoding]::UTF8)
  $updater = @'
$ErrorActionPreference = 'Continue'
$base = 'C:/ProgramData/OpsPlatformAgent'
$configPath = Join-Path $base 'agent-config.json'
$scriptPath = Join-Path $base 'ops-platform-agent.ps1'
$tempPath = Join-Path $base 'ops-platform-agent.ps1.new'
$targetVersion = '__TARGET_VERSION__'
$hostId = '__HOST_ID__'
function Escape-JsonString($value) {
  if ($null -eq $value) { return '' }
  return ([string]$value).Replace('\\', '\\\\').Replace('"', '\\"').Replace([string][char]13, '\\r').Replace([string][char]10, '\\n')
}
try {
  Start-Sleep -Seconds 8
  $moved = $false
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    try {
      Move-Item -LiteralPath $tempPath -Destination $scriptPath -Force
      $moved = $true
      break
    } catch {
      if ($attempt -eq 30) { throw }
      Start-Sleep -Seconds 2
    }
  }
  if (-not $moved) { throw 'update script was not moved' }
  $escapedVersion = Escape-JsonString $targetVersion
  $configRaw = [System.IO.File]::ReadAllText($configPath, [Text.Encoding]::UTF8)
  $configRaw = [regex]::Replace($configRaw, '"agentVersion"\\s*:\\s*"[^"]*"', '"agentVersion":"' + $escapedVersion + '"')
  [System.IO.File]::WriteAllText($configPath, $configRaw, [Text.Encoding]::UTF8)
  $info = '{"version":"' + $escapedVersion + '","hostId":"' + (Escape-JsonString $hostId) + '","installedBy":"ops-platform-legacy-self-update"}'
  [System.IO.File]::WriteAllText((Join-Path $base 'agent-info.json'), $info, [Text.Encoding]::UTF8)
  $intervalMinutes = 1
  try {
    $match = [regex]::Match($configRaw, '"intervalSeconds"\\s*:\\s*([0-9]+)')
    if ($match.Success) { $intervalMinutes = [Math]::Max(1, [Math]::Ceiling([double]$match.Groups[1].Value / 60)) }
  } catch {}
  $taskAction = 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "' + $scriptPath + '" once'
  $created = $false
  for ($attempt = 1; $attempt -le 30; $attempt += 1) {
    & schtasks.exe /Create /TN OpsPlatformAgent /SC MINUTE /MO $intervalMinutes /RU SYSTEM /RL HIGHEST /TR $taskAction /F | Out-Null
    if ($LASTEXITCODE -eq 0) { $created = $true; break }
    Start-Sleep -Seconds 2
  }
  if (-not $created) { throw 'scheduled task create failed after retries' }
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $scriptPath + '" once'
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden
} finally {
  Remove-Item -LiteralPath $tempPath -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $MyInvocation.MyCommand.Path -Force -ErrorAction SilentlyContinue
}
'@
  $updater = $updater.Replace('__TARGET_VERSION__', $targetVersion.Replace("'", "''"))
  $updater = $updater.Replace('__HOST_ID__', $hostId.Replace("'", "''"))
  [System.IO.File]::WriteAllText($updaterPath, $updater, [Text.Encoding]::UTF8)
  $arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $updaterPath + '"'
  Start-Process -FilePath 'powershell.exe' -ArgumentList $arguments -WindowStyle Hidden
  Write-Output "Detached Agent updater scheduled to $targetVersion"
  exit 0
} catch {
  Write-Error ("Detached Agent updater failed to schedule: " + $_.Exception.Message)
  exit 1
}
`
}

async function recoverStaleUpdateJobForHost(hostId: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - AGENT_UPDATE_RUNNING_TIMEOUT_MS)
  const minutes = Math.ceil(AGENT_UPDATE_RUNNING_TIMEOUT_MS / 60000)
  await prisma.hostAgentJob.updateMany({
    where: { hostId, type: 'update_agent', status: 'running', updatedAt: { lt: cutoff } },
    data: {
      status: 'failed',
      completedAt: now,
      summary: `Agent 更新超时，旧 Agent 未回传结果（超过 ${minutes} 分钟）`,
      stderr: `Agent update job timed out after ${minutes} minutes without result callback.`,
    },
  })
}

router.post('/hosts/:id/offline-enroll', async (req, res, next) => {
  try {
    const { installerToken } = offlineEnrollSchema.parse(req.body)
    const result = await enrollWindowsOfflineAgent(req.params.id, installerToken)
    if (!result) return res.status(404).json({ message: '主机不存在' })
    res.json(result)
  } catch (error) {
    if (error instanceof Error && ['JsonWebTokenError', 'TokenExpiredError'].includes(error.name)) {
      return res.status(401).json({ message: '离线 Agent 安装令牌无效或已过期' })
    }
    if (error instanceof Error && error.message.includes('离线 Agent 安装令牌')) {
      return res.status(401).json({ message: error.message })
    }
    next(error)
  }
})

router.get('/hosts/:id/jobs/next', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    await recoverStaleUpdateJobForHost(auth.host.id)
    const supportedJobTypes = ['start_service', 'stop_service', 'restart_service', 'batch_run_script', 'batch_file_operation', 'update_agent']
    const job = await prisma.hostAgentJob.findFirst({
      where: { hostId: auth.host.id, status: 'pending', type: { in: supportedJobTypes } },
      orderBy: { createdAt: 'asc' },
    })
    if (!job) return res.json({ job: null })

    if (job.type === 'update_agent') {
      await prisma.hostAgentJob.update({ where: { id: job.id }, data: { status: 'running', summary: `Agent 正在更新到 ${AGENT_VERSION}` } })
      await touchAgentHeartbeat(auth.host.id)
      if (auth.host.os === 'Windows' && !isAgentVersionAtLeast(auth.host.agentVersion, WINDOWS_SELF_UPDATE_MIN_AGENT_VERSION)) {
        await prisma.hostAgentJob.update({
          where: { id: job.id },
          data: {
            status: 'failed',
            completedAt: new Date(),
            summary: `当前 Windows Agent ${auth.host.agentVersion || '-'} 不支持可靠自更新，请下载离线脚本升级到 ${AGENT_VERSION}`,
            stderr: 'Legacy Windows Agent self-update is disabled because the old agent cannot reliably execute update jobs.',
          },
        })
        return res.json({ job: null })
      }
      if (auth.host.os === 'Windows' && !isAgentVersionAtLeast(auth.host.agentVersion, WINDOWS_NATIVE_SELF_UPDATE_MIN_AGENT_VERSION)) {
        await prisma.hostAgentJob.update({
          where: { id: job.id },
          data: { summary: `旧版 Windows Agent 正在通过兼容脚本更新到 ${AGENT_VERSION}` },
        })
        return res.json({
          job: {
            id: job.id,
            type: 'batch_run_script',
            action: 'run_script',
            scriptBase64: Buffer.from(buildLegacyWindowsSelfUpdateScript(), 'utf8').toString('base64'),
            timeoutSeconds: 180,
          },
        })
      }
      return res.json({ job: { id: job.id, type: job.type, targetVersion: AGENT_VERSION } })
    }

    if (job.type === 'batch_run_script') {
      const payload = parseBatchPayload(job)
      if (!payload.batchJobId || !payload.batchTargetId || !payload.scriptBase64) {
        await prisma.hostAgentJob.update({ where: { id: job.id }, data: { status: 'failed', summary: '批处理 Agent 任务参数不完整', completedAt: new Date() } })
        return res.json({ job: null })
      }
      await prisma.hostAgentJob.update({ where: { id: job.id }, data: { status: 'running', summary: 'Windows Agent 正在执行批处理脚本' } })
      await prisma.batchJobTarget.updateMany({ where: { id: payload.batchTargetId, hostId: auth.host.id }, data: { status: 'running', summary: 'Windows Agent 已拉取脚本，正在执行' } })
      await touchAgentHeartbeat(auth.host.id)
      return res.json({ job: { id: job.id, type: job.type, action: 'run_script', batchJobId: payload.batchJobId, batchTargetId: payload.batchTargetId, scriptBase64: payload.scriptBase64, timeoutSeconds: payload.timeoutSeconds || 120 } })
    }

    if (job.type === 'batch_file_operation') {
      const payload = parseBatchPayload(job)
      if (!payload.batchJobId || !payload.batchTargetId || !payload.action || !payload.targetDirectory || !payload.fileName) {
        await prisma.hostAgentJob.update({ where: { id: job.id }, data: { status: 'failed', summary: 'Windows 文件批处理 Agent 任务参数不完整', completedAt: new Date() } })
        return res.json({ job: null })
      }
      await prisma.hostAgentJob.update({ where: { id: job.id }, data: { status: 'running', summary: 'Windows Agent 正在执行文件批处理' } })
      await prisma.batchJobTarget.updateMany({ where: { id: payload.batchTargetId, hostId: auth.host.id }, data: { status: 'running', summary: 'Windows Agent 已拉取文件任务，正在执行' } })
      await touchAgentHeartbeat(auth.host.id)
      return res.json({ job: { id: job.id, type: job.type, ...payload } })
    }

    const action = actionForJobType(job.type)
    let payload: { serviceId?: string; serviceName?: string } = {}
    try {
      payload = JSON.parse(job.stdout || '{}')
    } catch {
      await prisma.hostAgentJob.update({ where: { id: job.id }, data: { status: 'failed', summary: 'Agent 服务控制任务参数损坏', completedAt: new Date() } })
      return res.json({ job: null })
    }
    if (!action || !payload.serviceId || !payload.serviceName) {
      await prisma.hostAgentJob.update({ where: { id: job.id }, data: { status: 'failed', summary: 'Agent 服务控制任务参数不完整', completedAt: new Date() } })
      return res.json({ job: null })
    }

    await prisma.hostAgentJob.update({ where: { id: job.id }, data: { status: 'running', summary: `Windows Agent 正在执行服务${action}：${payload.serviceName}` } })
    await touchAgentHeartbeat(auth.host.id)
    res.json({ job: { id: job.id, type: job.type, action, serviceId: payload.serviceId, serviceName: payload.serviceName } })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/jobs/:jobId/result', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    const job = await prisma.hostAgentJob.findFirst({ where: { id: req.params.jobId, hostId: auth.host.id } })
    if (!job) return res.status(404).json({ message: 'Agent 任务不存在' })

    const now = new Date()
    if (job.type === 'update_agent') {
      const result = updateAgentJobResultSchema.parse(req.body)
      const version = result.version || AGENT_VERSION
      const summary = result.summary || (result.success ? `Agent 已更新到 ${version}` : 'Agent 更新失败')
      await prisma.hostAgentJob.update({
        where: { id: job.id },
        data: {
          status: result.success ? 'success' : 'failed',
          summary,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          completedAt: now,
        },
      })
      if (result.success) {
        await prisma.host.update({
          where: { id: auth.host.id },
          data: { agentVersion: version, agentStatus: '正常', status: '在线', lastHeartbeat: shanghaiTime(now) },
        })
      }
      await touchAgentHeartbeat(auth.host.id)
      return res.json({ ok: true })
    }

    if (job.type === 'batch_run_script') {
      const result = batchScriptJobResultSchema.parse(req.body)
      const payload = parseBatchPayload(job)
      const summary = result.summary || (result.success ? '批处理脚本执行成功' : '批处理脚本执行失败')
      await prisma.hostAgentJob.update({
        where: { id: job.id },
        data: {
          status: result.success ? 'success' : 'failed',
          summary,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          completedAt: now,
        },
      })
      if (payload.batchTargetId && payload.batchJobId) {
        await prisma.batchJobTarget.updateMany({
          where: { id: payload.batchTargetId, hostId: auth.host.id },
          data: {
            status: result.success ? 'success' : 'failed',
            exitCode: result.exitCode ?? (result.success ? 0 : 1),
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            summary,
            completedAt: now,
          },
        })
        await refreshBatchJobStatus(payload.batchJobId)
      }
      await touchAgentHeartbeat(auth.host.id)
      return res.json({ ok: true })
    }

    if (job.type === 'batch_file_operation') {
      const result = batchFileJobResultSchema.parse(req.body)
      const payload = parseBatchPayload(job) as Record<string, unknown>
      const summary = result.summary || (result.success ? 'Windows 文件批处理执行成功' : 'Windows 文件批处理执行失败')
      await prisma.hostAgentJob.update({
        where: { id: job.id },
        data: {
          status: result.success ? 'success' : 'failed',
          summary,
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          completedAt: now,
        },
      })
      await completeWindowsBatchFileAgentResult(auth.host.id, payload, { ...result, summary })
      await touchAgentHeartbeat(auth.host.id)
      return res.json({ ok: true })
    }

    const result = agentJobResultSchema.parse(req.body)
    const summary = result.summary || (result.success ? `服务${result.action}执行成功` : `服务${result.action}执行失败`)
    await prisma.hostAgentJob.update({
      where: { id: job.id },
      data: {
        status: result.success ? 'success' : 'failed',
        summary,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        completedAt: now,
      },
    })
    if (result.success) {
      await prisma.hostService.updateMany({
        where: { id: result.serviceId, hostId: auth.host.id },
        data: { status: statusForAction(result.action), lastReportedAt: now },
      })
    }
    await prisma.serviceEvent.create({
      data: {
        hostId: auth.host.id,
        service: result.serviceName,
        eventType: `agent_service_${result.action}_${result.success ? 'success' : 'failed'}`,
        level: result.success ? 'INFO' : 'ERROR',
        message: summary,
        occurredAt: now,
        source: 'ops-platform-agent',
        payload: { serviceId: result.serviceId, action: result.action, jobId: job.id },
      },
    })
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

router.get('/hosts/:id/update-package', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    const os = auth.host.os === 'Windows' ? 'Windows' : 'Linux'
    res.json(buildAgentUpdatePackage(os))
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/metrics', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    const values = metricsSchema.parse(req.body)
    await recordHostMetrics(auth.host.id, { ...values, sampledAt: values.sampledAt ? new Date(values.sampledAt) : undefined })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

router.get('/hosts/:id/log-config', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    res.json({ paths: await getHostLogCollectionPaths(auth.host.id) })
  } catch (error) {
    next(error)
  }
})

router.get('/hosts/:id/log-monitor-config', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    res.json(await getAgentLocalLogMonitorConfig(auth.host.id))
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/log-monitor-results', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    const values = localLogMonitorResultsSchema.parse(req.body)
    const result = await ingestAgentLocalLogMonitorResults(auth.host.id, values.results.map((item) => ({
      ...item,
      windowStart: item.windowStart ? new Date(item.windowStart) : undefined,
      windowEnd: item.windowEnd ? new Date(item.windowEnd) : undefined,
    })), values.sampledAt ? new Date(values.sampledAt) : undefined)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, ...result })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/log-status', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    const values = logCollectionStatusSchema.parse(req.body)
    await upsertHostLogCollectionStatus(auth.host.id, {
      ...values,
      sampledAt: values.sampledAt ? new Date(values.sampledAt) : undefined,
      rawPayload: values.rawPayload ?? req.body,
    })
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/logs', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    const parsed = logsSchema.safeParse(req.body)
    if (!parsed.success) {
      const sample = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 3).map((log: unknown) => {
        const item = log && typeof log === 'object' && !Array.isArray(log) ? log as Record<string, unknown> : {}
        return {
          timestamp: item.timestamp,
          serviceType: typeof item.service,
          serviceLength: typeof item.service === 'string' ? item.service.length : undefined,
          level: item.level,
          messageType: typeof item.message,
          messageLength: typeof item.message === 'string' ? item.message.length : undefined,
          sourceType: typeof item.source,
          traceIdType: typeof item.traceId,
        }
      }) : []
      console.warn('[agent-logs] invalid payload', { hostId: auth.host.id, issues: parsed.error.issues, sample })
      alertAgentLogUploadFailure(auth.host.id, '日志上传参数不正确，后端已拒绝入库', { issues: parsed.error.issues, sample }).catch((error) => console.error('Agent log upload alert failed:', error))
      return next(new ZodError(parsed.error.issues))
    }

    const count = await ingestAgentLogs(auth.host.id, parsed.data.logs)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/services', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    const { services } = servicesSchema.parse(req.body)
    const count = await ingestHostServices(auth.host.id, services)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/service-events', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    const { events } = serviceEventsSchema.parse(req.body)
    const count = await ingestServiceEvents(auth.host.id, events)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/containers', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    const { containers } = containersSchema.parse(req.body)
    const count = await ingestHostContainers(auth.host.id, containers)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

export default router
