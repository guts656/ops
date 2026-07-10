import { Client, type SFTPWrapper } from 'ssh2'
import type { RemoteCommandResult, RemoteConnectionInput, RemoteFileDownloadResult, RemoteFileUploadResult } from './types'

const DEFAULT_TIMEOUT_MS = 20000
const OUTPUT_LIMIT = 4000
const SHELL_UPLOAD_CHUNK_SIZE = 60000

function truncate(value: string) {
  return value.length > OUTPUT_LIMIT ? `${value.slice(0, OUTPUT_LIMIT)}\n...输出已截断` : value
}

function shSingle(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

function connect(input: RemoteConnectionInput) {
  return new Promise<Client>((resolve, reject) => {
    const client = new Client()
    const timer = windowlessTimeout(() => {
      client.end()
      reject(new Error('SSH 连接超时'))
    }, input.timeoutMs ?? DEFAULT_TIMEOUT_MS)

    client
      .on('ready', () => {
        clearTimeout(timer)
        resolve(client)
      })
      .on('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      .connect({
        host: input.host,
        port: input.port,
        username: input.username,
        password: input.authType === '密码' ? input.password : undefined,
        privateKey: input.authType === '密钥' ? input.privateKey : undefined,
        readyTimeout: input.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        tryKeyboard: false,
      })
  })
}

function windowlessTimeout(callback: () => void, ms: number) {
  return setTimeout(callback, ms)
}

function timeoutError(action: string, ms: number) {
  return new Error(`${action}超时（${ms}ms）`)
}

function withTimeout<T>(promise: Promise<T>, ms: number, action: string, onTimeout?: () => void) {
  return new Promise<T>((resolve, reject) => {
    const timer = windowlessTimeout(() => {
      onTimeout?.()
      reject(timeoutError(action, ms))
    }, ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (error) => {
        clearTimeout(timer)
        reject(error)
      },
    )
  })
}

function openSftp(client: Client) {
  return new Promise<SFTPWrapper>((resolve, reject) => {
    client.sftp((error, sftp) => {
      if (error) reject(error)
      else resolve(sftp)
    })
  })
}

function writeRemoteFile(sftp: SFTPWrapper, remotePath: string, content: Buffer) {
  return new Promise<void>((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, { mode: 0o600 })
    stream.on('error', reject)
    stream.on('finish', () => resolve())
    stream.end(content)
  })
}

function statRemoteFile(sftp: SFTPWrapper, remotePath: string) {
  return new Promise<{ size: number; mode?: number }>((resolve, reject) => {
    sftp.stat(remotePath, (error, stats) => {
      if (error) reject(error)
      else resolve({ size: stats.size, mode: stats.mode })
    })
  })
}

function isRegularFile(mode?: number) {
  return mode === undefined || (mode & 0o170000) === 0o100000
}

function readRemoteFile(sftp: SFTPWrapper, remotePath: string, expectedBytes: number) {
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let bytes = 0
    const stream = sftp.createReadStream(remotePath)
    stream.on('data', (chunk: Buffer) => {
      bytes += chunk.length
      chunks.push(chunk)
    })
    stream.on('error', reject)
    stream.on('end', () => {
      const content = Buffer.concat(chunks)
      if (content.length !== expectedBytes) reject(new Error(`文件读取长度不一致：期望 ${expectedBytes} 字节，实际 ${content.length} 字节`))
      else resolve(content)
    })
  })
}

export async function runSshCommand(input: RemoteConnectionInput, command: string): Promise<RemoteCommandResult> {
  let client: Client
  try {
    client = await connect(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, stdout: '', stderr: message, summary: `SSH 连接失败：${message}` }
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    return await withTimeout(new Promise<RemoteCommandResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      client.exec(command, { pty: false }, (error, stream) => {
        if (error) {
          client.end()
          resolve({ success: false, stdout: '', stderr: error.message, summary: `SSH 命令启动失败：${error.message}` })
          return
        }

        stream
          .on('close', (code: number | undefined) => {
            client.end()
            const success = code === 0
            resolve({
              success,
              stdout: truncate(stdout),
              stderr: truncate(stderr),
              summary: success ? 'SSH 命令执行成功' : `SSH 命令执行失败，退出码 ${code ?? 'unknown'}`,
            })
          })
          .on('data', (data: Buffer) => {
            stdout += data.toString('utf8')
          })
          .stderr.on('data', (data: Buffer) => {
            stderr += data.toString('utf8')
          })
      })
    }), timeoutMs, 'SSH 命令执行', () => client.end())
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, stdout: '', stderr: message, summary: `SSH 命令执行失败：${message}`, timedOut: message.includes('超时'), timeoutMs: message.includes('超时') ? timeoutMs : undefined }
  }
}

async function uploadSshFileByShell(input: RemoteConnectionInput, remotePath: string, content: Buffer, sftpError?: string): Promise<RemoteFileUploadResult> {
  const tempPath = `${remotePath}.ops-upload-${Date.now().toString(36)}.b64`
  const encoded = content.toString('base64')
  const init = await runSshCommand(input, `rm -f ${shSingle(tempPath)} && : > ${shSingle(tempPath)}`)
  if (!init.success) {
    return { success: false, stdout: init.stdout, stderr: [sftpError, init.stderr].filter(Boolean).join('\n'), summary: `文件上传失败：SFTP 不可用，Shell 初始化临时文件失败（${init.summary}）`, remotePath, bytes: content.length }
  }

  for (let offset = 0; offset < encoded.length; offset += SHELL_UPLOAD_CHUNK_SIZE) {
    const chunk = encoded.slice(offset, offset + SHELL_UPLOAD_CHUNK_SIZE)
    const append = await runSshCommand(input, `printf '%s' ${shSingle(chunk)} >> ${shSingle(tempPath)}`)
    if (!append.success) {
      await runSshCommand(input, `rm -f ${shSingle(tempPath)}`)
      return { success: false, stdout: append.stdout, stderr: [sftpError, append.stderr].filter(Boolean).join('\n'), summary: `文件上传失败：SFTP 不可用，Shell 写入分片失败（${append.summary}）`, remotePath, bytes: content.length }
    }
  }

  const commit = await runSshCommand(input, `base64 -d ${shSingle(tempPath)} > ${shSingle(remotePath)} && chmod 600 ${shSingle(remotePath)} && rm -f ${shSingle(tempPath)} && printf 'BYTES=%s\n' $(wc -c < ${shSingle(remotePath)})`)
  if (!commit.success) {
    await runSshCommand(input, `rm -f ${shSingle(tempPath)}`)
    return { success: false, stdout: commit.stdout, stderr: [sftpError, commit.stderr].filter(Boolean).join('\n'), summary: `文件上传失败：SFTP 不可用，Shell 解码落盘失败（${commit.summary}）`, remotePath, bytes: content.length }
  }

  return { success: true, stdout: commit.stdout, stderr: sftpError ? `SFTP 上传失败，已自动改用 Shell base64 上传：${sftpError}` : '', summary: '文件上传成功（Shell base64 兜底）', remotePath, bytes: content.length }
}

export async function downloadSshFile(input: RemoteConnectionInput, remotePath: string, maxBytes: number): Promise<RemoteFileDownloadResult> {
  let client: Client
  try {
    client = await connect(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, stdout: '', stderr: message, summary: `SSH 连接失败：${message}`, remotePath, bytes: 0 }
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const sftp = await withTimeout(openSftp(client), timeoutMs, 'SFTP 打开', () => client.end())
    const stats = await withTimeout(statRemoteFile(sftp, remotePath), timeoutMs, 'SFTP 检查文件', () => client.end())
    if (!isRegularFile(stats.mode)) {
      client.end()
      return { success: false, stdout: '', stderr: '目标不是普通文件', summary: '文件下载失败：目标不是普通文件', remotePath, bytes: stats.size }
    }
    if (stats.size > maxBytes) {
      client.end()
      return { success: false, stdout: '', stderr: `文件大小 ${stats.size} 字节超过限制 ${maxBytes} 字节`, summary: `文件下载失败：文件超过大小限制（${stats.size}/${maxBytes} 字节）`, remotePath, bytes: stats.size }
    }
    const content = await withTimeout(readRemoteFile(sftp, remotePath, stats.size), timeoutMs, 'SFTP 读取文件', () => client.end())
    client.end()
    return { success: true, stdout: '', stderr: '', summary: '文件下载成功（SFTP）', remotePath, bytes: content.length, content }
  } catch (error) {
    client.end()
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, stdout: '', stderr: message, summary: `文件下载失败：${message}`, remotePath, bytes: 0, timedOut: message.includes('超时'), timeoutMs: message.includes('超时') ? timeoutMs : undefined }
  }
}

export async function uploadSshFile(input: RemoteConnectionInput, remotePath: string, content: Buffer): Promise<RemoteFileUploadResult> {
  let client: Client
  try {
    client = await connect(input)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { success: false, stdout: '', stderr: message, summary: `SSH 连接失败：${message}`, remotePath, bytes: content.length }
  }

  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS
  try {
    const sftp = await withTimeout(openSftp(client), timeoutMs, 'SFTP 打开', () => client.end())
    await withTimeout(writeRemoteFile(sftp, remotePath, content), timeoutMs, 'SFTP 写入文件', () => client.end())
    client.end()
    return { success: true, stdout: '', stderr: '', summary: '文件上传成功（SFTP）', remotePath, bytes: content.length }
  } catch (error) {
    client.end()
    const message = error instanceof Error ? error.message : String(error)
    return uploadSshFileByShell(input, remotePath, content, message)
  }
}

export async function testSshConnection(input: RemoteConnectionInput): Promise<RemoteCommandResult> {
  const result = await runSshCommand(input, 'os_version="$(if [ -r /etc/os-release ]; then . /etc/os-release; printf "%s" "$PRETTY_NAME"; else uname -sr; fi)"; printf "HOSTNAME=%s\\n" "$(hostname)"; printf "OS=%s\\n" "$os_version"')
  const hostname = result.stdout.match(/HOSTNAME=(.*)/)?.[1]?.trim()
  const osVersion = result.stdout.match(/OS=(.*)/)?.[1]?.trim()
  return {
    ...result,
    summary: result.success ? 'SSH 连通性验证成功' : result.summary,
    hostname,
    osVersion,
  }
}
