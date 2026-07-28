import { existsSync, readFileSync, chmodSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { generateKeyPairSync } from 'node:crypto'
import { hostname } from 'node:os'

const DEFAULT_KEY_PATH = join(process.cwd(), 'storage', 'ssh-keys', 'ops-platform-linux-agent_rsa')

function keyPath() {
  return process.env.OPS_LINUX_SSH_KEY_PATH?.trim() || DEFAULT_KEY_PATH
}

function base64UrlToBuffer(value: string) {
  return Buffer.from(value.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function sshString(value: Buffer | string) {
  const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value)
  const length = Buffer.alloc(4)
  length.writeUInt32BE(buffer.length, 0)
  return Buffer.concat([length, buffer])
}

function mpint(value: Buffer) {
  let buffer = value
  while (buffer.length > 1 && buffer[0] === 0) buffer = buffer.subarray(1)
  if (buffer[0] & 0x80) buffer = Buffer.concat([Buffer.from([0]), buffer])
  return sshString(buffer)
}

function toSshRsaPublicKey(publicJwk: { e?: string; n?: string }) {
  if (!publicJwk.e || !publicJwk.n) throw new Error('Linux SSH 公钥生成失败')
  const blob = Buffer.concat([
    sshString('ssh-rsa'),
    mpint(base64UrlToBuffer(publicJwk.e)),
    mpint(base64UrlToBuffer(publicJwk.n)),
  ])
  return `ssh-rsa ${blob.toString('base64')} ops-platform@${hostname()}`
}

async function generateLinuxSshKeyPair(path: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 4096 })
  const privatePem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString()
  const publicJwk = publicKey.export({ format: 'jwk' }) as { e?: string; n?: string }
  const publicText = `${toSshRsaPublicKey(publicJwk)}\n`
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, privatePem, { encoding: 'utf8', mode: 0o600 })
  await writeFile(`${path}.pub`, publicText, { encoding: 'utf8', mode: 0o644 })
  try { chmodSync(path, 0o600) } catch {}
  return { privateKey: privatePem, publicKey: publicText.trim() }
}

export async function ensureLinuxSshKeyPair() {
  const path = keyPath()
  if (!existsSync(path) || !existsSync(`${path}.pub`)) return generateLinuxSshKeyPair(path)
  try { chmodSync(path, 0o600) } catch {}
  return {
    privateKey: readFileSync(path, 'utf8'),
    publicKey: readFileSync(`${path}.pub`, 'utf8').trim(),
  }
}

export function getLinuxSshPrivateKey() {
  const path = keyPath()
  if (!existsSync(path)) throw new Error('平台 Linux SSH 私钥不存在，请先在主机页面生成平台专用公钥')
  try { chmodSync(path, 0o600) } catch {}
  return readFileSync(path, 'utf8')
}

function inferAllowedFrom() {
  const configured = process.env.OPS_LINUX_SSH_ALLOWED_FROM?.trim()
  if (configured) return configured
  const publicUrl = process.env.OPS_AGENT_PUBLIC_URL?.trim()
  if (!publicUrl) return ''
  try {
    const host = new URL(publicUrl).hostname
    return host && !['localhost', '127.0.0.1', '::1'].includes(host) ? host : ''
  } catch {
    return ''
  }
}

function shSingle(value: string) {
  return `'${value.replace(/'/g, `'"'"'`)}'`
}

export async function getLinuxSshKeyInfo() {
  const { publicKey } = await ensureLinuxSshKeyPair()
  const allowedFrom = inferAllowedFrom()
  const authorizedKey = allowedFrom ? `from="${allowedFrom}" ${publicKey}` : publicKey
  const installCommand = [
    'mkdir -p ~/.ssh',
    'chmod 700 ~/.ssh',
    `touch ~/.ssh/authorized_keys`,
    `grep -qxF ${shSingle(authorizedKey)} ~/.ssh/authorized_keys || echo ${shSingle(authorizedKey)} >> ~/.ssh/authorized_keys`,
    'chmod 600 ~/.ssh/authorized_keys',
  ].join(' && ')
  return {
    publicKey,
    authorizedKey,
    allowedFrom,
    privateKeyPath: keyPath(),
    installCommand,
  }
}
