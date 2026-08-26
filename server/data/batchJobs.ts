import { createHash } from 'node:crypto'
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { downloadSshFile, runSshCommand, uploadSshFile } from '../remote/ssh'
import type { RemoteCommandResult, RemoteConnectionInput } from '../remote/types'
import { downloadWinrmFile, runWinrmCommand, uploadWinrmFile } from '../remote/winrm'
import { decryptSecret } from '../utils/credentialCrypto'
import { getLinuxSshPrivateKey } from '../utils/linuxSshKey'
import { shanghaiTime } from '../utils/time'

type BatchJobRow = NonNullable<Awaited<ReturnType<typeof prisma.batchJob.findFirst>>> & { targets?: BatchJobTargetRow[]; artifacts?: BatchJobArtifactRow[] }
type BatchJobTargetRow = NonNullable<Awaited<ReturnType<typeof prisma.batchJobTarget.findFirst>>>
type BatchJobArtifactRow = NonNullable<Awaited<ReturnType<typeof prisma.batchJobArtifact.findFirst>>>
type BatchTargetHost = NonNullable<Awaited<ReturnType<typeof prisma.host.findFirst>>> & { pullCredential?: NonNullable<Awaited<ReturnType<typeof prisma.hostPullCredential.findFirst>>> | null }
type ExecutionResult = boolean | 'queued'
type BatchAgentFileAction = 'upload_file' | 'compare_file' | 'download_file'

export type BatchJobType = 'upload_file' | 'run_script' | 'compare_file' | 'download_file'
type TargetMode = 'hosts' | 'group'

export interface CreateBatchJobInput {
  name: string
  type: BatchJobType
  targetMode?: TargetMode
  targetOs?: 'Linux' | 'Windows'
  hostIds?: string[]
  hostGroup?: string
  targetDirectory?: string
  fileName?: string
  fileContentBase64?: string
  fileMd5?: string
  maxFileSize?: number
  script?: string
  baselineMd5?: string
  retryOfJobId?: string
}

const DEFAULT_DOWNLOAD_FILE_BYTES = 1024 * 1024
const MAX_DOWNLOAD_FILE_BYTES = 5 * 1024 * 1024
const FILE_PREVIEW_BYTES = 4096
const ARTIFACT_ROOT = 'storage/batch-files'
const SOURCE_FILE_NAME = 'source.bin'
const SOURCE_FILE_RETENTION_MS = 30 * 24 * 60 * 60 * 1000
const SOURCE_STAGING_MAX_AGE_MS = 24 * 60 * 60 * 1000
const SOURCE_ORPHAN_MAX_AGE_MS = 24 * 60 * 60 * 1000
const WINDOWS_BATCH_FILE_MIN_AGENT_VERSION = 'v2.10.18'
const WINDOWS_BATCH_JOB_TIMEOUT_MS = 5 * 60 * 1000

function id(prefix: string) {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function paramsObject(value: Prisma.JsonValue | null | undefined) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function toJob(row: BatchJobRow) {
  const targets = row.targets ?? []
  const artifacts = row.artifacts ?? []
  const params = paramsObject(row.params)
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    status: row.status,
    operator: row.operator,
    targetMode: params.targetMode as TargetMode | undefined,
    hostGroup: typeof params.hostGroup === 'string' ? params.hostGroup : undefined,
    targetDirectory: row.targetDirectory ?? undefined,
    fileName: row.fileName ?? undefined,
    fileSize: row.fileSize ?? undefined,
    script: row.script ?? undefined,
    params: row.params ?? undefined,
    fileMd5: typeof params.fileMd5 === 'string' ? params.fileMd5 : undefined,
    baselineMd5: typeof params.baselineMd5 === 'string' ? params.baselineMd5 : undefined,
    retryOfJobId: row.retryOfJobId ?? undefined,
    maxFileSize: typeof params.maxFileSize === 'number' ? params.maxFileSize : undefined,
    startedAt: shanghaiTime(row.startedAt),
    completedAt: row.completedAt ? shanghaiTime(row.completedAt) : undefined,
    summary: row.summary,
    totalTargets: targets.length,
    successTargets: targets.filter((target) => target.status === 'success').length,
    failedTargets: targets.filter((target) => target.status === 'failed').length,
    targets: targets.map((target) => toTarget(target, artifacts.filter((artifact) => artifact.targetId === target.id))),
    artifacts: artifacts.map(toArtifact),
  }
}

function toTarget(row: BatchJobTargetRow, artifacts: BatchJobArtifactRow[] = []) {
  return {
    id: row.id,
    jobId: row.jobId,
    hostId: row.hostId,
    hostIp: row.hostIp,
    hostname: row.hostname,
    status: row.status,
    remotePath: row.remotePath ?? undefined,
    exitCode: row.exitCode ?? undefined,
    stdout: row.stdout,
    stderr: row.stderr,
    summary: row.summary,
    startedAt: shanghaiTime(row.startedAt),
    completedAt: row.completedAt ? shanghaiTime(row.completedAt) : undefined,
    artifacts: artifacts.map(toArtifact),
  }
}

function toArtifact(row: BatchJobArtifactRow) {
  return {
    id: row.id,
    jobId: row.jobId,
    targetId: row.targetId,
    hostId: row.hostId,
    fileName: row.fileName,
    remotePath: row.remotePath,
    size: row.size,
    md5: row.md5,
    mimeType: row.mimeType ?? undefined,
    createdAt: shanghaiTime(row.createdAt),
  }
}

function shSingle(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function safeFileName(value: string) {
  const trimmed = value.trim()
  if (!trimmed || trimmed.includes('/') || trimmed.includes('\\') || trimmed === '.' || trimmed === '..') throw new Error('文件名不能包含路径')
  return trimmed
}

function safeLinuxDirectory(value: string) {
  const trimmed = value.trim()
  if (!trimmed.startsWith('/')) throw new Error('Linux 目标目录必须是绝对路径')
  if (trimmed.includes('\0') || trimmed.split('/').includes('..')) throw new Error('目标目录不能包含非法路径片段')
  return trimmed.replace(/\/+$/, '') || '/'
}

function safeWindowsDirectory(value: string) {
  const trimmed = value.trim().replace(/\/+/g, '\\')
  if (!/^[A-Za-z]:\\/.test(trimmed)) throw new Error('Windows 目标目录必须是盘符绝对路径，例如 C:\\Temp')
  if (trimmed.includes('\0') || trimmed.split('\\').includes('..')) throw new Error('目标目录不能包含非法路径片段')
  const normalized = trimmed.replace(/\\+$/, '')
  return /^[A-Za-z]:$/.test(normalized) ? `${normalized}\\` : normalized
}

function safeDirectory(os: BatchTargetHost['os'], value: string) {
  return os === 'Windows' ? safeWindowsDirectory(value) : safeLinuxDirectory(value)
}

function psDouble(value: string) {
  return `"${value.replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"')}"`
}

function md5Hex(content: Buffer) {
  return createHash('md5').update(content).digest('hex')
}

function normalizeMd5(value?: string) {
  const normalized = value?.trim().toLowerCase()
  return normalized && /^[a-f0-9]{32}$/.test(normalized) ? normalized : undefined
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

function maxFileSize(value?: number) {
  if (!value || !Number.isFinite(value)) return DEFAULT_DOWNLOAD_FILE_BYTES
  return Math.min(MAX_DOWNLOAD_FILE_BYTES, Math.max(1, Math.floor(value)))
}

function remotePathFor(host: BatchTargetHost, targetDirectory = '', fileName = '') {
  const directory = safeDirectory(host.os, targetDirectory)
  const name = safeFileName(fileName)
  return host.os === 'Windows' ? `${directory}\\${name}` : `${directory}/${name}`
}

function previewText(content: Buffer) {
  const chunk = content.subarray(0, FILE_PREVIEW_BYTES)
  const text = chunk.toString('utf8')
  if (text.includes('\0')) return ''
  return text
}

async function verifyLinuxMd5(connection: RemoteConnectionInput, remotePath: string, expectedMd5: string) {
  const result = await runSshCommand(connection, `if command -v md5sum >/dev/null 2>&1; then md5sum ${shSingle(remotePath)} | awk '{print $1}'; else openssl md5 -r ${shSingle(remotePath)} | awk '{print $1}'; fi`)
  const actualMd5 = result.stdout.trim().split(/\s+/)[0]?.toLowerCase()
  const success = result.success && actualMd5 === expectedMd5
  return { success, actualMd5, stdout: result.stdout, stderr: result.stderr, summary: success ? `MD5 校验通过：${actualMd5}` : `MD5 校验失败：期望 ${expectedMd5}，实际 ${actualMd5 || '获取失败'}` }
}

async function verifyWindowsMd5(connection: RemoteConnectionInput, remotePath: string, expectedMd5: string) {
  const result = await runWinrmCommand(connection, `(Get-FileHash -LiteralPath ${psDouble(remotePath)} -Algorithm MD5).Hash.ToLowerInvariant()`)
  const actualMd5 = result.stdout.trim().split(/\s+/)[0]?.toLowerCase()
  const success = result.success && actualMd5 === expectedMd5
  return { success, actualMd5, stdout: result.stdout, stderr: result.stderr, summary: success ? `MD5 校验通过：${actualMd5}` : `MD5 校验失败：期望 ${expectedMd5}，实际 ${actualMd5 || '获取失败'}` }
}

function isWindowsAgentReady(host: BatchTargetHost) {
  return host.os === 'Windows' && host.status === '在线' && host.agentStatus === '正常' && Boolean(host.agentTokenHash)
}

function isWindowsAgentFileReady(host: BatchTargetHost) {
  return isWindowsAgentReady(host) && isAgentVersionAtLeast(host.agentVersion || '', WINDOWS_BATCH_FILE_MIN_AGENT_VERSION)
}

function md5OfStdout(stdout: string) {
  return stdout.match(/MD5=([a-f0-9]{32})/i)?.[1]?.toLowerCase()
}

function connectionFor(host: BatchTargetHost): RemoteConnectionInput {
  if (host.os === 'Linux' && !host.pullCredential?.enabled) {
    return {
      host: host.ip,
      port: host.sshPort || 22,
      username: host.owner || 'root',
      authType: '密钥',
      privateKey: getLinuxSshPrivateKey(),
      os: host.os as RemoteConnectionInput['os'],
      timeoutMs: 15000,
    }
  }
  if (!host.pullCredential?.enabled) throw new Error(`Windows 主机未保存 WinRM Pull 凭据，无法通过批处理远程执行：${host.ip}`)
  const secret = decryptSecret(host.pullCredential)
  return {
    host: host.ip,
    port: host.pullCredential.sshPort,
    username: host.pullCredential.sshUsername,
    authType: host.pullCredential.authType as RemoteConnectionInput['authType'],
    password: host.pullCredential.authType === '密码' ? secret : undefined,
    privateKey: host.pullCredential.authType === '密钥' ? secret : undefined,
    os: host.os as RemoteConnectionInput['os'],
    timeoutMs: 15000,
  }
}

async function resolveTargetHostIds(input: CreateBatchJobInput) {
  const targetMode = input.targetMode || 'hosts'
  if (targetMode === 'group') {
    const group = input.hostGroup?.trim()
    if (!group) throw new Error('请选择主机组')
    const hosts = await prisma.host.findMany({ where: { group, os: input.targetOs }, orderBy: { ip: 'asc' }, select: { id: true } })
    return { targetMode, hostGroup: group, hostIds: hosts.map((host) => host.id) }
  }
  return { targetMode, hostGroup: undefined, hostIds: Array.from(new Set(input.hostIds ?? [])) }
}

async function loadTargetHosts(hostIds: string[], input: CreateBatchJobInput) {
  const hosts = await prisma.host.findMany({ where: { id: { in: hostIds } }, include: { pullCredential: true } })
  const byId = new Map(hosts.map((host) => [host.id, host]))
  return hostIds.map((hostId) => {
    const host = byId.get(hostId)
    if (!host) throw new Error(`主机不存在：${hostId}`)
    if (host.os === 'Linux') return host as BatchTargetHost
    if (host.os === 'Windows') {
      const targetHost = host as BatchTargetHost
      if (input.type === 'run_script') {
        if (!isWindowsAgentReady(targetHost)) throw new Error(`Windows 主机 Agent 未在线或未正常，无法通过 Agent 执行批处理：${host.ip}`)
        return targetHost
      }
      if (!isWindowsAgentFileReady(targetHost)) throw new Error(`Windows 文件类批处理需要 Agent ${WINDOWS_BATCH_FILE_MIN_AGENT_VERSION}+ 且在线正常，请先批量更新 Agent：${host.ip}`)
      return targetHost
    }
    if (!host.pullCredential || !host.pullCredential.enabled) throw new Error(`主机未启用远程 Pull 凭据：${host.ip}`)
    return host as BatchTargetHost
  })
}

async function executeUpload(targetId: string, host: BatchTargetHost, input: CreateBatchJobInput) {
  const targetDirectory = safeDirectory(host.os, input.targetDirectory || '')
  const fileName = safeFileName(input.fileName || '')
  const content = Buffer.from(input.fileContentBase64 || '', 'base64')
  if (content.length > 5 * 1024 * 1024) throw new Error('单个上传文件不能超过 5MB')
  const expectedMd5 = md5Hex(content)
  const clientMd5 = normalizeMd5(input.fileMd5)
  if (clientMd5 && clientMd5 !== expectedMd5) throw new Error(`上传文件 MD5 与服务端计算不一致：客户端 ${clientMd5}，服务端 ${expectedMd5}`)

  const remotePath = host.os === 'Windows' ? `${targetDirectory}\\${fileName}` : `${targetDirectory}/${fileName}`
  const connection = connectionFor(host)
  if (host.os === 'Windows') {
    const mkdir = await runWinrmCommand(connection, `New-Item -ItemType Directory -Force -Path ${psDouble(targetDirectory)} | Out-Null`)
    if (!mkdir.success) {
      await finishTarget(targetId, false, mkdir.summary, '', mkdir.stderr, remotePath)
      return false
    }
    const upload = await uploadWinrmFile(connection, remotePath, content)
    if (!upload.success) {
      await finishTarget(targetId, false, upload.summary, upload.stdout, upload.stderr, remotePath)
      return false
    }
    const verify = await verifyWindowsMd5(connection, remotePath, expectedMd5)
    await finishTarget(targetId, verify.success, verify.summary, [upload.stdout, verify.stdout, `EXPECTED_MD5=${expectedMd5}`, verify.actualMd5 ? `REMOTE_MD5=${verify.actualMd5}` : ''].filter(Boolean).join('\n'), [upload.stderr, verify.stderr].filter(Boolean).join('\n'), remotePath)
    return verify.success
  }

  const mkdir = await runSshCommand(connection, `mkdir -p ${shSingle(targetDirectory)}`)
  if (!mkdir.success) {
    await finishTarget(targetId, false, mkdir.summary, '', mkdir.stderr, remotePath)
    return false
  }

  const upload = await uploadSshFile(connection, remotePath, content)
  if (!upload.success) {
    await finishTarget(targetId, false, upload.summary, upload.stdout, upload.stderr, remotePath)
    return false
  }
  const verify = await verifyLinuxMd5(connection, remotePath, expectedMd5)
  await finishTarget(targetId, verify.success, verify.summary, [upload.stdout, verify.stdout, `EXPECTED_MD5=${expectedMd5}`, verify.actualMd5 ? `REMOTE_MD5=${verify.actualMd5}` : ''].filter(Boolean).join('\n'), [upload.stderr, verify.stderr].filter(Boolean).join('\n'), remotePath)
  return verify.success
}

function exitCodeOf(result: RemoteCommandResult) {
  if (result.success) return 0
  return Number(result.summary.match(/退出码 (\d+)/)?.[1] ?? 1)
}

async function executeWindowsAgentScript(jobId: string, targetId: string, host: BatchTargetHost, script: string): Promise<'queued'> {
  if (!isWindowsAgentReady(host)) throw new Error(`Windows Agent 未在线或未正常：${host.ip}`)
  const agentJobId = id('agent-job')
  await prisma.hostAgentJob.create({
    data: {
      id: agentJobId,
      hostId: host.id,
      type: 'batch_run_script',
      transport: 'agent',
      status: 'pending',
      operator: `batch:${jobId}`,
      summary: '批处理脚本等待 Windows Agent 拉取执行',
      stdout: JSON.stringify({
        batchJobId: jobId,
        batchTargetId: targetId,
        scriptBase64: Buffer.from(script, 'utf8').toString('base64'),
        timeoutSeconds: 120,
      }),
    },
  })
  await prisma.batchJobTarget.update({
    where: { id: targetId },
    data: {
      status: 'running',
      exitCode: null,
      stdout: `AGENT_JOB_ID=${agentJobId}`,
      stderr: '',
      summary: '已下发到 Windows Agent，等待目标主机拉取执行',
    },
  })
  return 'queued'
}

async function executeWindowsAgentFileJob(jobId: string, targetId: string, host: BatchTargetHost, input: CreateBatchJobInput): Promise<'queued'> {
  if (!isWindowsAgentFileReady(host)) throw new Error(`Windows Agent 版本过低或未在线，文件类批处理需要 ${WINDOWS_BATCH_FILE_MIN_AGENT_VERSION}+：${host.ip}`)
  const action = input.type as BatchAgentFileAction
  const targetDirectory = safeWindowsDirectory(input.targetDirectory || '')
  const fileName = safeFileName(input.fileName || '')
  const remotePath = `${targetDirectory}\\${fileName}`
  const content = action === 'upload_file' && input.fileContentBase64 !== undefined ? Buffer.from(input.fileContentBase64, 'base64') : undefined
  if (action === 'upload_file' && content === undefined) throw new Error('上传文件内容缺失')
  if (content && content.length > 5 * 1024 * 1024) throw new Error('单个上传文件不能超过 5MB')
  const expectedMd5 = content !== undefined ? md5Hex(content) : normalizeMd5(input.fileMd5)
  const agentJobId = id('agent-job')
  await prisma.hostAgentJob.create({
    data: {
      id: agentJobId,
      hostId: host.id,
      type: 'batch_file_operation',
      transport: 'agent',
      status: 'pending',
      operator: `batch:${jobId}`,
      summary: 'Windows 文件批处理等待 Agent 拉取执行',
      stdout: JSON.stringify({
        action,
        batchJobId: jobId,
        batchTargetId: targetId,
        targetDirectory,
        fileName,
        remotePath,
        fileContentBase64: content !== undefined ? content.toString('base64') : undefined,
        expectedMd5,
        maxFileSize: action === 'compare_file' || action === 'download_file' ? maxFileSize(input.maxFileSize) : undefined,
        persistArtifact: action === 'download_file',
      }),
    },
  })
  await prisma.batchJobTarget.update({
    where: { id: targetId },
    data: {
      status: 'running',
      exitCode: null,
      remotePath,
      stdout: `AGENT_JOB_ID=${agentJobId}`,
      stderr: '',
      summary: '已下发到 Windows Agent，等待目标主机拉取执行文件任务',
    },
  })
  return 'queued'
}

async function executeScript(jobId: string, targetId: string, host: BatchTargetHost, input: CreateBatchJobInput): Promise<ExecutionResult> {
  const script = input.script?.trim()
  if (!script) throw new Error('脚本内容不能为空')
  if (script.length > 20000) throw new Error('脚本内容不能超过 20000 字符')

  let result: RemoteCommandResult
  if (host.os === 'Windows') {
    return executeWindowsAgentScript(jobId, targetId, host, script)
  }
  const connection = connectionFor(host)
  const payload = Buffer.from(script, 'utf8').toString('base64')
  const command = `tmp=$(mktemp /tmp/ops-batch.XXXXXX.sh) && printf '%s' ${shSingle(payload)} | base64 -d > "$tmp" && chmod 700 "$tmp" && /bin/bash "$tmp"; code=$?; rm -f "$tmp"; exit $code`
  result = await runSshCommand(connection, command)
  await prisma.batchJobTarget.update({ where: { id: targetId }, data: { status: result.success ? 'success' : 'failed', exitCode: exitCodeOf(result), stdout: result.stdout, stderr: result.stderr, summary: result.summary, completedAt: new Date() } })
  return result.success
}

async function downloadRemoteFile(host: BatchTargetHost, remotePath: string, limit: number) {
  const connection = connectionFor(host)
  return host.os === 'Windows' ? downloadWinrmFile(connection, remotePath, limit) : downloadSshFile(connection, remotePath, limit)
}

function artifactLocalPath(jobId: string, targetId: string, fileName: string) {
  return `${ARTIFACT_ROOT}/${jobId}/${targetId}/${fileName}`
}

function sourceFileLocalPath(jobId: string) {
  return `${ARTIFACT_ROOT}/${jobId}/${SOURCE_FILE_NAME}`
}

async function stageSourceFile(jobId: string, content: Buffer) {
  const directory = join(process.cwd(), ARTIFACT_ROOT, jobId)
  const stagedPath = join(directory, `${SOURCE_FILE_NAME}.staging`)
  const finalPath = join(directory, SOURCE_FILE_NAME)
  await mkdir(directory, { recursive: true })
  await writeFile(stagedPath, content, { flag: 'wx' })
  await rename(stagedPath, finalPath)
  return sourceFileLocalPath(jobId)
}

async function removeJobFiles(jobId: string) {
  await rm(join(process.cwd(), ARTIFACT_ROOT, jobId), { recursive: true, force: true })
}

async function removeSourceFile(localPath: string) {
  await rm(join(process.cwd(), localPath), { force: true })
}

async function saveArtifact(jobId: string, targetId: string, host: BatchTargetHost, remotePath: string, fileName: string, content: Buffer, md5: string, db: Pick<Prisma.TransactionClient, 'batchJobArtifact'> = prisma) {
  const relativePath = artifactLocalPath(jobId, targetId, fileName)
  const absolutePath = join(process.cwd(), relativePath)
  await mkdir(join(process.cwd(), ARTIFACT_ROOT, jobId, targetId), { recursive: true })
  await writeFile(absolutePath, content)
  return db.batchJobArtifact.upsert({
    where: { targetId },
    create: {
      id: id('batch-artifact'),
      jobId,
      targetId,
      hostId: host.id,
      fileName,
      remotePath,
      localPath: relativePath,
      size: content.length,
      md5,
      mimeType: 'application/octet-stream',
    },
    update: {
      fileName,
      remotePath,
      localPath: relativePath,
      size: content.length,
      md5,
      mimeType: 'application/octet-stream',
    },
  })
}

interface FileReadResult {
  success: boolean
  targetId: string
  remotePath: string
  bytes?: number
  md5?: string
  preview?: string
  artifactId?: string
}

async function executeFileRead(jobId: string, targetId: string, host: BatchTargetHost, input: CreateBatchJobInput, persistArtifact: boolean): Promise<FileReadResult> {
  const fileName = safeFileName(input.fileName || '')
  const remotePath = remotePathFor(host, input.targetDirectory, fileName)
  const result = await downloadRemoteFile(host, remotePath, maxFileSize(input.maxFileSize))
  if (!result.success || !result.content) {
    await finishTarget(targetId, false, result.summary, result.stdout, result.stderr, remotePath)
    return { success: false, targetId, remotePath }
  }

  const md5 = md5Hex(result.content)
  const preview = previewText(result.content)
  const stdout = [`REMOTE_PATH=${remotePath}`, `BYTES=${result.bytes}`, `MD5=${md5}`, preview ? `PREVIEW:\n${preview}` : ''].filter(Boolean).join('\n')
  let artifactId: string | undefined
  if (persistArtifact) {
    const artifact = await saveArtifact(jobId, targetId, host, remotePath, fileName, result.content, md5)
    artifactId = artifact.id
  }
  await finishTarget(targetId, true, `读取完成：${result.bytes} bytes，MD5 ${md5}`, stdout, '', remotePath)
  return { success: true, targetId, remotePath, bytes: result.bytes, md5, preview, artifactId }
}

async function finishTarget(targetId: string, success: boolean, summary: string, stdout: string, stderr: string, remotePath?: string) {
  await prisma.batchJobTarget.update({ where: { id: targetId }, data: { status: success ? 'success' : 'failed', remotePath, stdout, stderr, summary, completedAt: new Date() } })
}

export async function refreshGenericBatchJobStatus(jobId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${jobId}))`
    const targets = await tx.batchJobTarget.findMany({ where: { jobId }, select: { status: true } })
    if (!targets.length) return
    const running = targets.filter((target) => target.status === 'running').length
    const success = targets.filter((target) => target.status === 'success').length
    const failed = targets.filter((target) => target.status === 'failed').length
    if (running > 0) {
      await tx.batchJob.updateMany({
        where: { id: jobId, status: 'running', targets: { some: { status: 'running' } } },
        data: { summary: `执行中：成功 ${success}，失败 ${failed}，等待 ${running}` },
      })
      return
    }
    const status = success === targets.length ? 'success' : success === 0 ? 'failed' : 'partial'
    await tx.batchJob.updateMany({
      where: { id: jobId, status: 'running', targets: { none: { status: 'running' } } },
      data: { status, completedAt: new Date(), summary: `完成 ${success}/${targets.length} 台主机，失败 ${failed}` },
    })
  })
}

export async function refreshCompareBatchJobStatus(jobId: string) {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${jobId}))`
    const [job, targets] = await Promise.all([
      tx.batchJob.findUnique({ where: { id: jobId }, select: { params: true, status: true } }),
      tx.batchJobTarget.findMany({ where: { jobId }, orderBy: { startedAt: 'asc' } }),
    ])
    if (!job || job.status !== 'running' || !targets.length || targets.some((target) => target.status === 'running')) return

    const successful = targets.filter((target) => target.status === 'success' && md5OfStdout(target.stdout))
    const jobParams = paramsObject(job.params)
    const baselineMd5 = normalizeMd5(typeof jobParams.baselineMd5 === 'string' ? jobParams.baselineMd5 : undefined) ?? md5OfStdout(successful[0]?.stdout || '')
    let matched = 0
    let mismatched = 0
    if (baselineMd5) {
      for (const target of successful) {
        const md5 = md5OfStdout(target.stdout)
        const same = md5 === baselineMd5
        if (same) matched += 1
        else mismatched += 1
        await tx.batchJobTarget.update({
          where: { id: target.id },
          data: { status: same ? 'success' : 'failed', summary: same ? `与基线一致：MD5 ${md5}` : `与基线不一致：基线 ${baselineMd5}，当前 ${md5}` },
        })
      }
    }

    const failed = targets.length - matched
    const status = matched === targets.length ? 'success' : matched === 0 ? 'failed' : 'partial'
    await tx.batchJob.updateMany({
      where: { id: jobId, status: 'running', targets: { none: { status: 'running' } } },
      data: {
        status,
        completedAt: new Date(),
        summary: `对比完成：一致 ${matched}，不一致 ${mismatched}，失败 ${failed - mismatched}`,
        params: { ...jobParams, baselineMd5, matchedTargets: matched, mismatchedTargets: mismatched, failedTargets: failed - mismatched } as Prisma.InputJsonValue,
      },
    })
  })
}

export async function completeWindowsBatchFileAgentResult(agentJobId: string, hostId: string, payload: Record<string, unknown>, result: { success: boolean; summary?: string; stdout?: string; stderr?: string; exitCode?: number; remotePath?: string; bytes?: number; md5?: string; preview?: string; contentBase64?: string }) {
  const batchJobId = typeof payload.batchJobId === 'string' ? payload.batchJobId : undefined
  const batchTargetId = typeof payload.batchTargetId === 'string' ? payload.batchTargetId : undefined
  const action = payload.action as BatchAgentFileAction | undefined
  if (!batchJobId || !batchTargetId || !action) return
  const host = await prisma.host.findUnique({ where: { id: hostId }, include: { pullCredential: true } })
  if (!host) return

  const summary = result.summary || (result.success ? 'Windows Agent 文件批处理执行成功' : 'Windows Agent 文件批处理执行失败')
  const remotePath = result.remotePath || (typeof payload.remotePath === 'string' ? payload.remotePath : undefined)
  const md5 = normalizeMd5(result.md5)
  const bytes = typeof result.bytes === 'number' && Number.isFinite(result.bytes) ? Math.max(0, Math.floor(result.bytes)) : undefined
  const preview = result.preview?.trim()
  const stdout = [
    result.stdout?.trim(),
    remotePath ? `REMOTE_PATH=${remotePath}` : '',
    bytes !== undefined ? `BYTES=${bytes}` : '',
    md5 ? `MD5=${md5}` : '',
    preview ? `PREVIEW:\n${preview}` : '',
  ].filter(Boolean).join('\n')

  const now = new Date()
  const content = result.success && action === 'download_file' && result.contentBase64 !== undefined && remotePath && md5
    ? Buffer.from(result.contentBase64, 'base64')
    : undefined
  const completed = await prisma.$transaction(async (tx) => {
    const agentJob = await tx.hostAgentJob.updateMany({
      where: { id: agentJobId, hostId, status: 'running' },
      data: {
        status: result.success ? 'success' : 'failed',
        summary,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        completedAt: now,
      },
    })
    if (agentJob.count === 0) return false
    const target = await tx.batchJobTarget.updateMany({
      where: { id: batchTargetId, hostId, status: 'running' },
      data: {
        status: result.success ? 'success' : 'failed',
        exitCode: result.exitCode ?? (result.success ? 0 : 1),
        remotePath,
        stdout,
        stderr: result.stderr || '',
        summary,
        completedAt: now,
      },
    })
    if (target.count === 0) throw new Error('批处理目标已结束，拒绝迟到的 Agent 回调')
    if (content && remotePath && md5) {
      await saveArtifact(batchJobId, batchTargetId, host as BatchTargetHost, remotePath, safeFileName(typeof payload.fileName === 'string' ? payload.fileName : 'download.bin'), content, md5, tx)
    }
    return true
  })
  if (!completed) return

  if (action === 'compare_file') await refreshCompareBatchJobStatus(batchJobId)
  else await refreshGenericBatchJobStatus(batchJobId)
}

export async function recoverStaleWindowsBatchJobs(batchJobId?: string, now = new Date()) {
  const cutoff = new Date(now.getTime() - WINDOWS_BATCH_JOB_TIMEOUT_MS)
  const agentJobs = await prisma.hostAgentJob.findMany({
    where: {
      type: { in: ['batch_run_script', 'batch_file_operation'] },
      status: { in: ['pending', 'running'] },
      updatedAt: { lt: cutoff },
      operator: { startsWith: 'batch:' },
    },
  })
  const affectedJobIds = new Set<string>()
  for (const agentJob of agentJobs) {
    const payload = parseAgentJobBatchPayload(agentJob.stdout)
    if (!payload.batchJobId || !payload.batchTargetId || (batchJobId && payload.batchJobId !== batchJobId)) continue
    await prisma.$transaction([
      prisma.hostAgentJob.updateMany({
        where: { id: agentJob.id, status: { in: ['pending', 'running'] } },
        data: {
          status: 'failed',
          summary: 'Windows Agent 批处理超过 5 分钟未回传结果',
          stderr: 'Windows Agent batch job timed out after 5 minutes without a result callback.',
          completedAt: now,
        },
      }),
      prisma.batchJobTarget.updateMany({
        where: { id: payload.batchTargetId, hostId: agentJob.hostId, status: 'running' },
        data: {
          status: 'failed',
          exitCode: 124,
          summary: 'Windows Agent 批处理超过 5 分钟未回传结果',
          stderr: '请先将目标主机 Agent 升级到当前版本；若已是当前版本，请检查计划任务和 Agent 子进程执行。',
          completedAt: now,
        },
      }),
    ])
    affectedJobIds.add(payload.batchJobId)
  }
  for (const id of affectedJobIds) {
    const job = await prisma.batchJob.findUnique({ where: { id }, select: { type: true } })
    if (job?.type === 'compare_file') await refreshCompareBatchJobStatus(id)
    else if (job) await refreshGenericBatchJobStatus(id)
  }
  return affectedJobIds.size
}

function parseAgentJobBatchPayload(stdout: string) {
  try {
    const payload = JSON.parse(stdout || '{}') as Record<string, unknown>
    return {
      batchJobId: typeof payload.batchJobId === 'string' ? payload.batchJobId : undefined,
      batchTargetId: typeof payload.batchTargetId === 'string' ? payload.batchTargetId : undefined,
    }
  } catch {
    return {}
  }
}

export async function listBatchJobs() {
  await recoverStaleWindowsBatchJobs()
  const jobs = await prisma.batchJob.findMany({ include: { targets: { orderBy: { startedAt: 'asc' } }, artifacts: true }, orderBy: { startedAt: 'desc' }, take: 100 })
  return jobs.map(toJob)
}

export async function getBatchJob(id: string) {
  await recoverStaleWindowsBatchJobs(id)
  const job = await prisma.batchJob.findUnique({ where: { id }, include: { targets: { orderBy: { startedAt: 'asc' } }, artifacts: true } })
  return job ? toJob(job) : undefined
}

export async function getBatchJobArtifact(jobId: string, artifactId: string) {
  const artifact = await prisma.batchJobArtifact.findFirst({ where: { id: artifactId, jobId } })
  if (!artifact) return undefined
  const content = await readFile(join(process.cwd(), artifact.localPath))
  return { artifact: toArtifact(artifact), content, fileName: artifact.fileName }
}

async function runCompareJob(jobId: string, targets: BatchJobTargetRow[], hosts: BatchTargetHost[], input: CreateBatchJobInput) {
  const results: FileReadResult[] = []
  let queuedCount = 0
  for (const [index, host] of hosts.entries()) {
    const target = targets[index]
    try {
      if (host.os === 'Windows') {
        await executeWindowsAgentFileJob(jobId, target.id, host, input)
        queuedCount += 1
      } else {
        results.push(await executeFileRead(jobId, target.id, host, input, false))
      }
    } catch (error) {
      await finishTarget(target.id, false, error instanceof Error ? error.message : '执行失败', '', error instanceof Error ? error.message : String(error))
      results.push({ success: false, targetId: target.id, remotePath: '' })
    }
  }

  if (queuedCount > 0) {
    await prisma.batchJob.updateMany({
      where: { id: jobId, status: 'running', targets: { some: { status: 'running' } } },
      data: { summary: `已下发 Windows Agent ${queuedCount} 台，等待文件对比结果回传` },
    })
    return
  }

  const successful = results.filter((result) => result.success && result.md5)
  const persistedParams = paramsObject((await prisma.batchJob.findUnique({ where: { id: jobId }, select: { params: true } }))?.params)
  const baselineMd5 = normalizeMd5(input.baselineMd5) ?? normalizeMd5(typeof persistedParams.baselineMd5 === 'string' ? persistedParams.baselineMd5 : undefined) ?? successful[0]?.md5
  let matched = 0
  let mismatched = 0
  if (baselineMd5) {
    for (const result of successful) {
      const same = result.md5 === baselineMd5
      if (same) matched += 1
      else mismatched += 1
      await prisma.batchJobTarget.update({
        where: { id: result.targetId },
        data: {
          status: same ? 'success' : 'failed',
          summary: same ? `与基线一致：MD5 ${result.md5}` : `与基线不一致：基线 ${baselineMd5}，当前 ${result.md5}`,
        },
      })
    }
  }

  const failed = targets.length - matched
  const status = matched === targets.length ? 'success' : matched === 0 ? 'failed' : 'partial'
  await prisma.batchJob.update({
    where: { id: jobId },
    data: {
      status,
      completedAt: new Date(),
      summary: `对比完成：一致 ${matched}，不一致 ${mismatched}，失败 ${failed - mismatched}`,
      params: { ...persistedParams, baselineMd5, matchedTargets: matched, mismatchedTargets: mismatched, failedTargets: failed - mismatched } as Prisma.InputJsonValue,
    },
  })
}

async function runBatchJob(jobId: string, targets: BatchJobTargetRow[], hosts: BatchTargetHost[], input: CreateBatchJobInput) {
  if (input.type === 'compare_file') {
    await runCompareJob(jobId, targets, hosts, input)
    return
  }

  let successCount = 0
  let queuedCount = 0
  for (const [index, host] of hosts.entries()) {
    const target = targets[index]
    try {
      const success = input.type === 'upload_file'
        ? host.os === 'Windows' ? await executeWindowsAgentFileJob(jobId, target.id, host, input) : await executeUpload(target.id, host, input)
        : input.type === 'download_file'
          ? host.os === 'Windows' ? await executeWindowsAgentFileJob(jobId, target.id, host, input) : (await executeFileRead(jobId, target.id, host, input, true)).success
          : await executeScript(jobId, target.id, host, input)
      if (success === 'queued') queuedCount += 1
      else if (success) successCount += 1
    } catch (error) {
      await finishTarget(target.id, false, error instanceof Error ? error.message : '执行失败', '', error instanceof Error ? error.message : String(error))
    }
  }

  if (queuedCount > 0) {
    await prisma.batchJob.updateMany({
      where: { id: jobId, status: 'running', targets: { some: { status: 'running' } } },
      data: { summary: `已完成 ${successCount} 台，已下发 Windows Agent ${queuedCount} 台，等待回传` },
    })
    return
  }
  const status = successCount === hosts.length ? 'success' : successCount === 0 ? 'failed' : 'partial'
  await prisma.batchJob.update({ where: { id: jobId }, data: { status, completedAt: new Date(), summary: `完成 ${successCount}/${hosts.length} 台主机` } })
}

interface PreparedBatchJob {
  input: CreateBatchJobInput
  operator: string
  jobId: string
  hostIds: string[]
  hostGroup?: string
  targetMode: TargetMode
  hosts: BatchTargetHost[]
  uploadContent?: Buffer
  fileMd5?: string
  sourceFilePath?: string
}

async function prepareBatchJob(input: CreateBatchJobInput, operator: string, hostIds?: string[]): Promise<PreparedBatchJob> {
  const targetInfo = hostIds
    ? { targetMode: 'hosts' as const, hostGroup: undefined, hostIds }
    : await resolveTargetHostIds(input)
  const uniqueHostIds = Array.from(new Set(targetInfo.hostIds))
  if (!uniqueHostIds.length) throw new Error('请选择目标主机')
  if (uniqueHostIds.length > 50) throw new Error('单次批处理最多选择 50 台主机')

  const hosts = await loadTargetHosts(uniqueHostIds, input)
  const jobId = id('batch-job')
  const uploadContent = input.type === 'upload_file' && input.fileContentBase64 !== undefined ? Buffer.from(input.fileContentBase64, 'base64') : undefined
  const fileMd5 = uploadContent !== undefined ? md5Hex(uploadContent) : undefined
  const clientMd5 = normalizeMd5(input.fileMd5)
  if (clientMd5 && fileMd5 && clientMd5 !== fileMd5) throw new Error(`上传文件 MD5 与服务端计算不一致：客户端 ${clientMd5}，服务端 ${fileMd5}`)
  const sourceFilePath = uploadContent !== undefined ? await stageSourceFile(jobId, uploadContent) : undefined
  return { input, operator, jobId, hostIds: uniqueHostIds, hostGroup: targetInfo.hostGroup, targetMode: targetInfo.targetMode, hosts, uploadContent, fileMd5, sourceFilePath }
}

async function createPreparedBatchJob(prepared: PreparedBatchJob) {
  const { input, operator, jobId, hostIds, hostGroup, targetMode, hosts, uploadContent, fileMd5, sourceFilePath } = prepared
  const params = {
    targetMode,
    targetOs: input.targetOs,
    hostIds,
    hostGroup,
    fileMd5,
    baselineMd5: normalizeMd5(input.baselineMd5),
    maxFileSize: input.type === 'compare_file' || input.type === 'download_file' ? maxFileSize(input.maxFileSize) : undefined,
  }
  try {
    return await prisma.batchJob.create({
      data: {
        id: jobId,
        name: input.name,
        type: input.type,
        status: 'running',
        operator,
        targetDirectory: input.targetDirectory,
        fileName: input.fileName,
        fileSize: input.type === 'upload_file' ? uploadContent?.length : undefined,
        script: input.type === 'run_script' ? input.script : undefined,
        params: params as Prisma.InputJsonValue,
        retryOfJobId: input.retryOfJobId,
        sourceFilePath,
        sourceFileExpiresAt: sourceFilePath ? new Date(Date.now() + SOURCE_FILE_RETENTION_MS) : undefined,
        summary: '批处理后台执行中',
        targets: {
          create: hosts.map((host) => ({ id: id('batch-target'), hostId: host.id, hostIp: host.ip, hostname: host.hostname, status: 'running', summary: '等待执行' })),
        },
      },
      include: { targets: { orderBy: { startedAt: 'asc' } }, artifacts: true },
    })
  } catch (error) {
    if (sourceFilePath) await removeJobFiles(jobId)
    throw error
  }
}

function startPreparedBatchJob(prepared: PreparedBatchJob, job: Awaited<ReturnType<typeof createPreparedBatchJob>>) {
  void runBatchJob(prepared.jobId, job.targets, prepared.hosts, prepared.input).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    const now = new Date()
    await prisma.$transaction([
      prisma.batchJobTarget.updateMany({
        where: { jobId: prepared.jobId, status: 'running' },
        data: {
          status: 'failed',
          exitCode: 125,
          completedAt: now,
          summary: `批处理执行异常：${message}`,
          stderr: '任务执行状态未知，请确认目标主机状态后再重跑失败主机。',
        },
      }),
      prisma.hostAgentJob.updateMany({
        where: { operator: `batch:${prepared.jobId}`, status: { in: ['pending', 'running'] } },
        data: { status: 'failed', completedAt: now, summary: `批处理执行异常：${message}` },
      }),
      prisma.batchJob.updateMany({
        where: { id: prepared.jobId, status: 'running' },
        data: { status: 'failed', completedAt: now, summary: `批处理执行异常：${message}` },
      }),
    ])
  })
}

export async function createBatchJob(input: CreateBatchJobInput, operator: string) {
  const prepared = await prepareBatchJob(input, operator)
  const job = await createPreparedBatchJob(prepared)
  startPreparedBatchJob(prepared, job)
  return toJob(job)
}

export class BatchJobRetryError extends Error {
  constructor(public code: 'not_found' | 'not_finished' | 'no_failed_targets' | 'source_missing', message: string) {
    super(message)
  }
}

function isUniqueConstraintError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002'
}

export async function rerunFailedBatchJob(jobId: string, operator: string) {
  const source = await prisma.batchJob.findUnique({
    where: { id: jobId },
    include: {
      targets: { orderBy: { startedAt: 'asc' } },
      retryJob: { include: { targets: { orderBy: { startedAt: 'asc' } }, artifacts: true } },
    },
  })
  if (!source) throw new BatchJobRetryError('not_found', '批处理任务不存在')
  if (source.retryJob) return toJob(source.retryJob)
  if (source.status === 'running') throw new BatchJobRetryError('not_finished', '任务仍在执行中，暂不能重跑')

  const failedHostIds = Array.from(new Set(source.targets.filter((target) => target.status === 'failed').map((target) => target.hostId)))
  if (!failedHostIds.length) throw new BatchJobRetryError('no_failed_targets', '该任务没有失败主机')

  const params = paramsObject(source.params)
  let fileContentBase64: string | undefined
  if (source.type === 'upload_file') {
    if (!source.sourceFilePath || !source.sourceFileExpiresAt || source.sourceFileExpiresAt <= new Date()) {
      throw new BatchJobRetryError('source_missing', '原上传文件已过期或不存在，无法重跑失败主机')
    }
    try {
      fileContentBase64 = (await readFile(join(process.cwd(), source.sourceFilePath))).toString('base64')
    } catch {
      throw new BatchJobRetryError('source_missing', '原上传文件不存在，无法重跑失败主机')
    }
  }

  const input: CreateBatchJobInput = {
    name: `${source.name}（失败重跑）`,
    type: source.type as BatchJobType,
    targetMode: 'hosts',
    targetOs: params.targetOs === 'Linux' || params.targetOs === 'Windows' ? params.targetOs : undefined,
    hostIds: failedHostIds,
    targetDirectory: source.targetDirectory ?? undefined,
    fileName: source.fileName ?? undefined,
    fileContentBase64,
    fileMd5: typeof params.fileMd5 === 'string' ? params.fileMd5 : undefined,
    maxFileSize: typeof params.maxFileSize === 'number' ? params.maxFileSize : undefined,
    script: source.script ?? undefined,
    baselineMd5: typeof params.baselineMd5 === 'string' ? params.baselineMd5 : undefined,
    retryOfJobId: source.id,
  }
  const prepared = await prepareBatchJob(input, operator, failedHostIds)
  try {
    const job = await createPreparedBatchJob(prepared)
    startPreparedBatchJob(prepared, job)
    return toJob(job)
  } catch (error) {
    if (!isUniqueConstraintError(error)) throw error
    const existing = await prisma.batchJob.findUnique({
      where: { retryOfJobId: source.id },
      include: { targets: { orderBy: { startedAt: 'asc' } }, artifacts: true },
    })
    if (!existing) throw error
    return toJob(existing)
  }
}

export async function recoverBatchJobsOnStartup(now = new Date()) {
  await recoverStaleWindowsBatchJobs(undefined, now)
  const jobs = await prisma.batchJob.findMany({
    where: { targets: { some: { status: 'running' } } },
    include: { targets: { where: { status: 'running' } } },
  })
  let interruptedTargets = 0
  for (const job of jobs) {
    const agentJobs = await prisma.hostAgentJob.findMany({
      where: {
        operator: `batch:${job.id}`,
        type: { in: ['batch_run_script', 'batch_file_operation'] },
        status: { in: ['pending', 'running'] },
      },
      select: { stdout: true },
    })
    const activeTargetIds = new Set(agentJobs.map((agentJob) => parseAgentJobBatchPayload(agentJob.stdout).batchTargetId).filter(Boolean))
    const unknownTargetIds = job.targets.map((target) => target.id).filter((targetId) => !activeTargetIds.has(targetId))
    if (unknownTargetIds.length) {
      const result = await prisma.batchJobTarget.updateMany({
        where: { id: { in: unknownTargetIds }, status: 'running' },
        data: {
          status: 'failed',
          exitCode: 125,
          summary: 'API 服务重启导致执行中断，远端执行结果未知',
          stderr: '任务不会自动重放；请确认目标主机状态后手工重跑失败主机。',
          completedAt: now,
        },
      })
      interruptedTargets += result.count
    }
    if (job.type === 'compare_file') await refreshCompareBatchJobStatus(job.id)
    else await refreshGenericBatchJobStatus(job.id)
  }
  return interruptedTargets
}

export async function cleanupExpiredBatchJobSources(now = new Date()) {
  const expired = await prisma.batchJob.findMany({
    where: { sourceFilePath: { not: null }, sourceFileExpiresAt: { lte: now } },
    select: { id: true, sourceFilePath: true },
  })
  for (const job of expired) {
    if (job.sourceFilePath) await removeSourceFile(job.sourceFilePath)
    await prisma.batchJob.updateMany({
      where: { id: job.id, sourceFileExpiresAt: { lte: now } },
      data: { sourceFilePath: null, sourceFileExpiresAt: null },
    })
  }

  const root = join(process.cwd(), ARTIFACT_ROOT)
  const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
  let orphaned = 0
  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    const stagedPath = join(root, entry.name, `${SOURCE_FILE_NAME}.staging`)
    const staged = await stat(stagedPath).catch(() => undefined)
    if (staged && staged.mtime.getTime() <= now.getTime() - SOURCE_STAGING_MAX_AGE_MS) await rm(stagedPath, { force: true })

    const sourcePath = join(root, entry.name, SOURCE_FILE_NAME)
    const source = await stat(sourcePath).catch(() => undefined)
    if (!source || source.mtime.getTime() > now.getTime() - SOURCE_ORPHAN_MAX_AGE_MS) continue
    const job = await prisma.batchJob.findUnique({ where: { id: entry.name }, select: { id: true } })
    if (!job) {
      await rm(sourcePath, { force: true })
      orphaned += 1
    }
  }
  return expired.length + orphaned
}
