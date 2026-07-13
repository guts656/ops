import { execFile } from 'node:child_process'
import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtemp, unlink, writeFile } from 'node:fs/promises'
import type { RemoteCommandResult, RemoteConnectionInput, RemoteFileDownloadResult, RemoteFileUploadResult } from './types'

const require = createRequire(import.meta.url)
const winrmClient = require('winrm-client') as {
  runPowershell: (command: string, host: string, username: string, password: string, port: number) => Promise<string | Error>
}

const DEFAULT_TIMEOUT_MS = 30000
const OUTPUT_LIMIT = 4000

function sanitizeText(value: string) {
  return value.replace(new RegExp(String.fromCharCode(0), 'g'), '')
}

function truncate(value: string) {
  const clean = sanitizeText(value)
  return clean.length > OUTPUT_LIMIT ? `${clean.slice(0, OUTPUT_LIMIT)}\n...输出已截断` : clean
}

function decodeXmlText(value: string) {
  return value
    .replace(/_x([0-9A-Fa-f]{4})_/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function decodeCliXml(value: string) {
  const clean = sanitizeText(value)
  if (!clean.includes('#< CLIXML')) return clean
  const messages = Array.from(clean.matchAll(/<S\s+S="(?:Error|Warning|Verbose|Debug|Information)"[^>]*>([\s\S]*?)<\/S>/g)).map((match) => decodeXmlText(match[1]).trim()).filter(Boolean)
  if (messages.length) return messages.join('\n')
  return decodeXmlText(clean.replace('#< CLIXML', '').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim()
}

function firstLine(value: string) {
  return value.split('\n').map((line) => line.trim()).find(Boolean) || 'unknown error'
}

function psString(value: string) {
  return `'${value.replace(/'/g, "''")}'`
}

function psDouble(value: string) {
  return `"${value.replace(/`/g, '``').replace(/\$/g, '`$').replace(/"/g, '`"')}"`
}

function encodePowerShell(script: string) {
  return Buffer.from(script, 'utf16le').toString('base64')
}

function compactPowerShell(script: string) {
  return script.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).join('; ')
}

function supportsLocalWindowsPowerShell() {
  return process.platform === 'win32'
}

function normalizeWinrmError(error: unknown, input?: RemoteConnectionInput) {
  const raw = error instanceof Error ? error.message || error.name : String(error || 'unknown error')
  const target = input ? `${input.host}:${input.port}` : '目标主机'
  if (/ECONNREFUSED|connect\s+ECONNREFUSED/i.test(raw)) return `${target} 拒绝连接，请确认目标 Windows 已启用 WinRM、端口 ${input?.port ?? 5985} 已监听且防火墙放行`
  if (/ETIMEDOUT|timed out|connect\s+ETIMEDOUT/i.test(raw)) return `${target} 连接超时，请确认网络可达、防火墙和 WinRM 端口配置`
  if (/ENOTFOUND|getaddrinfo/i.test(raw)) return `${target} 无法解析或访问，请检查主机 IP/域名`
  if (/401|unauthorized|access is denied|拒绝访问/i.test(raw)) return `${target} 认证失败，请检查 WinRM 用户名、密码和管理员权限`
  return raw
}

async function runNodeWinrmPowershell(input: RemoteConnectionInput, command: string) {
  if (input.authType !== '密码' || !input.password) throw new Error('Windows WinRM 暂只支持密码认证')
  const output = await winrmClient.runPowershell(command, input.host, input.username, input.password, input.port)
  if (output instanceof Error) throw output
  return sanitizeText(String(output || ''))
}

function nodeWinrmResult(output: string, options: { truncateOutput?: boolean } = {}): RemoteCommandResult {
  const exitMatch = output.match(/OPS_WINRM_EXIT=(-?\d+)/)
  const clean = output.replace(/OPS_WINRM_EXIT=\d+\s*/g, '').trim()
  if (exitMatch?.[1] && exitMatch[1] !== '0') {
    return { success: false, stdout: '', stderr: truncate(clean), summary: `WinRM 命令执行失败：${firstLine(clean)}` }
  }
  if (!exitMatch && /ParserError|Missing closing|FullyQualifiedErrorId|CategoryInfo/i.test(clean)) {
    return { success: false, stdout: '', stderr: truncate(clean), summary: `WinRM 命令执行失败：${firstLine(clean)}` }
  }
  return { success: true, stdout: options.truncateOutput === false ? clean : truncate(clean), stderr: '', summary: 'WinRM 命令执行成功' }
}

async function invokeLargeRemoteScriptViaNodeWinrm(input: RemoteConnectionInput, remoteScript: string, options: { truncateOutput?: boolean } = {}): Promise<RemoteCommandResult> {
  const id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
  const base = 'C:/ProgramData/OpsPlatformAgent'
  const scriptPath = `${base}\\ops-remote-${id}.ps1`
  const payloadPath = `${scriptPath}.b64`
  const encoded = Buffer.from(`$ErrorActionPreference = 'Stop'\n${remoteScript}`, 'utf8').toString('base64')

  try {
    await runNodeWinrmPowershell(input, `New-Item -ItemType Directory -Force -Path ${psString(base)} | Out-Null; Remove-Item -LiteralPath ${psString(scriptPath)}, ${psString(payloadPath)} -Force -ErrorAction SilentlyContinue`)
    for (let offset = 0; offset < encoded.length; offset += 60000) {
      const chunk = encoded.slice(offset, offset + 60000)
      const method = offset === 0 ? 'WriteAllText' : 'AppendAllText'
      await runNodeWinrmPowershell(input, `[IO.File]::${method}(${psString(payloadPath)}, ${psString(chunk)}, [Text.Encoding]::ASCII)`)
    }
    const output = await runNodeWinrmPowershell(input, `$bytes = [Convert]::FromBase64String((Get-Content -LiteralPath ${psString(payloadPath)} -Raw)); [IO.File]::WriteAllBytes(${psString(scriptPath)}, $bytes); & ${psString(scriptPath)}; Write-Output ('OPS_WINRM_EXIT=' + $LASTEXITCODE)`)
    await runNodeWinrmPowershell(input, `Remove-Item -LiteralPath ${psString(scriptPath)}, ${psString(payloadPath)} -Force -ErrorAction SilentlyContinue`).catch(() => undefined)
    return nodeWinrmResult(output, options)
  } catch (error) {
    await runNodeWinrmPowershell(input, `Remove-Item -LiteralPath ${psString(scriptPath)}, ${psString(payloadPath)} -Force -ErrorAction SilentlyContinue`).catch(() => undefined)
    const message = normalizeWinrmError(error, input)
    return { success: false, stdout: '', stderr: truncate(message), summary: `WinRM 命令执行失败：${firstLine(message)}` }
  }
}

async function invokeRemoteScriptViaNodeWinrm(input: RemoteConnectionInput, remoteScript: string, options: { truncateOutput?: boolean } = {}): Promise<RemoteCommandResult> {
  if (input.authType !== '密码' || !input.password) {
    return { success: false, stdout: '', stderr: 'Windows WinRM 暂只支持密码认证', summary: 'Windows WinRM 暂只支持密码认证' }
  }

  if (remoteScript.length > 6000) return invokeLargeRemoteScriptViaNodeWinrm(input, remoteScript, options)

  const command = compactPowerShell(`$ErrorActionPreference = 'Stop'
${remoteScript}
Write-Output ('OPS_WINRM_EXIT=' + $LASTEXITCODE)`)
  try {
    const text = await runNodeWinrmPowershell(input, command)
    return nodeWinrmResult(text, options)
  } catch (error) {
    const message = normalizeWinrmError(error, input)
    return {
      success: false,
      stdout: '',
      stderr: truncate(message),
      summary: `WinRM 命令执行失败：${firstLine(message)}`,
    }
  }
}

function isTimeoutError(error: Error | null | undefined) {
  if (!error) return false
  const candidate = error as Error & { code?: string | number, killed?: boolean, signal?: string | null }
  return candidate.code === 'ETIMEDOUT' || (candidate.killed && candidate.signal === 'SIGTERM') || /timed out/i.test(candidate.message)
}

async function invokeRemoteScript(input: RemoteConnectionInput, remoteScript: string, options: { truncateOutput?: boolean; maxBuffer?: number } = {}) {
  if (!supportsLocalWindowsPowerShell()) return invokeRemoteScriptViaNodeWinrm(input, remoteScript, options)

  if (input.authType !== '密码' || !input.password) {
    return { success: false, stdout: '', stderr: 'Windows WinRM 暂只支持密码认证', summary: 'Windows WinRM 暂只支持密码认证' }
  }

  const script = `
$ErrorActionPreference = 'Stop'
$password = ConvertTo-SecureString $env:OPS_REMOTE_PASSWORD -AsPlainText -Force
$credential = New-Object System.Management.Automation.PSCredential (${psString(input.username)}, $password)
$session = New-PSSession -ComputerName ${psString(input.host)} -Port ${input.port} -Credential $credential
try {
  Invoke-Command -Session $session -ScriptBlock {
${remoteScript}
  }
} finally {
  if ($session) { Remove-PSSession $session }
}
`

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const encoded = encodePowerShell(script)
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass']
  let tempScriptPath: string | undefined
  if (encoded.length > 24000) {
    const tempDir = await mkdtemp(join(tmpdir(), 'ops-winrm-'))
    tempScriptPath = join(tempDir, 'invoke.ps1')
    await writeFile(tempScriptPath, `﻿${script}`, 'utf16le')
    args.push('-File', tempScriptPath)
  } else {
    args.push('-EncodedCommand', encoded)
  }

  return new Promise<RemoteCommandResult>((resolve) => {
    execFile('powershell.exe', args, {
      timeout: timeoutMs,
      env: { ...process.env, OPS_REMOTE_PASSWORD: input.password },
      windowsHide: true,
      maxBuffer: options.maxBuffer,
    }, async (error, stdout, stderr) => {
      if (tempScriptPath) await unlink(tempScriptPath).catch(() => undefined)
      const decodedStderr = decodeCliXml(stderr || '')
      const cleanStdout = sanitizeText(stdout || '')
      const cleanStderr = sanitizeText(decodedStderr)
      const outputStdout = options.truncateOutput === false ? cleanStdout : truncate(cleanStdout)
      const outputStderr = options.truncateOutput === false ? cleanStderr : truncate(cleanStderr)
      const success = !error
      const timedOut = isTimeoutError(error)
      resolve({
        success,
        stdout: outputStdout,
        stderr: outputStderr,
        summary: success
          ? 'WinRM 命令执行成功'
          : timedOut
            ? `WinRM 命令执行超时（${timeoutMs}ms）`
            : `WinRM 命令执行失败：${cleanStderr ? firstLine(truncate(cleanStderr)) : error?.name ?? 'unknown error'}`,
        timedOut: timedOut || undefined,
        timeoutMs: timedOut ? timeoutMs : undefined,
      })
    })
  })
}

export async function testWinrmConnection(input: RemoteConnectionInput): Promise<RemoteCommandResult> {
  const result = await invokeRemoteScript(input, `
    $hostname = $env:COMPUTERNAME
    $os = (Get-CimInstance Win32_OperatingSystem).Caption
    Write-Output "HOSTNAME=$hostname"
    Write-Output "OS=$os"
`)
  const hostname = result.stdout.match(/HOSTNAME=(.*)/)?.[1]?.trim()
  const osVersion = result.stdout.match(/OS=(.*)/)?.[1]?.trim()
  return {
    ...result,
    summary: result.success ? 'WinRM 连通性验证成功' : result.summary,
    hostname,
    osVersion,
  }
}

export function runWinrmCommand(input: RemoteConnectionInput, remoteScript: string) {
  return invokeRemoteScript(input, remoteScript)
}

export async function downloadWinrmFile(input: RemoteConnectionInput, remotePath: string, maxBytes: number): Promise<RemoteFileDownloadResult> {
  const result = await invokeRemoteScript(input, `
    $target = ${psDouble(remotePath)}
    if (!(Test-Path -LiteralPath $target -PathType Leaf)) { throw "文件不存在或不是普通文件：$target" }
    $item = Get-Item -LiteralPath $target
    if ($item.Length -gt ${maxBytes}) { throw "文件大小 $($item.Length) 字节超过限制 ${maxBytes} 字节" }
    $bytes = [System.IO.File]::ReadAllBytes($item.FullName)
    Write-Output "OPS_FILE_BYTES=$($bytes.Length)"
    Write-Output "OPS_FILE_BASE64=$([Convert]::ToBase64String($bytes))"
  `, { truncateOutput: false, maxBuffer: Math.max(1024 * 1024, Math.ceil(maxBytes * 1.5) + 8192) })

  if (!result.success) return { ...result, remotePath, bytes: 0 }
  const bytesText = result.stdout.match(/OPS_FILE_BYTES=(\d+)/)?.[1]
  const encoded = result.stdout.match(/OPS_FILE_BASE64=([A-Za-z0-9+/=]+)/)?.[1]
  const bytes = Number(bytesText)
  if (!encoded || !Number.isFinite(bytes)) return { success: false, stdout: '', stderr: result.stdout, summary: '文件下载失败：无法解析 WinRM 返回内容', remotePath, bytes: 0 }
  const content = Buffer.from(encoded, 'base64')
  if (content.length !== bytes) return { success: false, stdout: '', stderr: `文件读取长度不一致：期望 ${bytes} 字节，实际 ${content.length} 字节`, summary: '文件下载失败：文件长度校验失败', remotePath, bytes: content.length }
  if (content.length > maxBytes) return { success: false, stdout: '', stderr: `文件大小 ${content.length} 字节超过限制 ${maxBytes} 字节`, summary: `文件下载失败：文件超过大小限制（${content.length}/${maxBytes} 字节）`, remotePath, bytes: content.length }
  return { success: true, stdout: '', stderr: '', summary: '文件下载成功（WinRM）', remotePath, bytes: content.length, content }
}

export async function uploadWinrmFile(input: RemoteConnectionInput, remotePath: string, content: Buffer): Promise<RemoteFileUploadResult> {
  const targetPath = remotePath.replace(/\\/g, '/')
  const tempPath = `${targetPath}.ops-upload-${Date.now().toString(36)}.b64`
  const prepare = await runWinrmCommand(input, `
    $directory = Split-Path -Parent ${psString(targetPath)}
    if ($directory) { New-Item -ItemType Directory -Force -Path $directory | Out-Null }
    if (Test-Path -LiteralPath ${psString(tempPath)}) { Remove-Item -LiteralPath ${psString(tempPath)} -Force }
    [IO.File]::WriteAllText(${psString(tempPath)}, '', [Text.Encoding]::ASCII)
  `)
  if (!prepare.success) return { ...prepare, remotePath, bytes: content.length }

  const encoded = content.toString('base64')
  const chunkSize = 2000
  for (let offset = 0; offset < encoded.length; offset += chunkSize) {
    const chunk = encoded.slice(offset, offset + chunkSize)
    const append = await runWinrmCommand(input, `[IO.File]::AppendAllText(${psString(tempPath)}, ${psString(chunk)}, [Text.Encoding]::ASCII)`)
    if (!append.success) return { ...append, remotePath, bytes: content.length }
  }

  const commit = await runWinrmCommand(input, `
    $bytes = [Convert]::FromBase64String([IO.File]::ReadAllText(${psString(tempPath)}) )
    [System.IO.File]::WriteAllBytes(${psString(targetPath)}, $bytes)
    Remove-Item -LiteralPath ${psString(tempPath)} -Force
    Write-Output ('BYTES=' + $bytes.Length)
  `)
  return { ...commit, summary: commit.success ? '文件上传成功' : commit.summary, remotePath, bytes: content.length }
}
