import { prisma } from '../db/prisma'
import type { RemoteConnectionInput } from '../remote/types'
import { decryptSecret } from '../utils/credentialCrypto'

type HostWithCredential = NonNullable<Awaited<ReturnType<typeof prisma.host.findFirst>>> & { pullCredential: NonNullable<Awaited<ReturnType<typeof prisma.hostPullCredential.findFirst>>> }

export interface ProbeHostSummary {
  id: string
  ip: string
  hostname: string
  os: 'Linux' | 'Windows'
}

function toSummary(host: { id: string; ip: string; hostname: string; os: string }): ProbeHostSummary {
  return { id: host.id, ip: host.ip, hostname: host.hostname, os: host.os as ProbeHostSummary['os'] }
}

function assertUsableProbeHost(host: NonNullable<Awaited<ReturnType<typeof prisma.host.findFirst>>> & { pullCredential?: Awaited<ReturnType<typeof prisma.hostPullCredential.findFirst>> | null }) {
  if (!host.pullCredential || !host.pullCredential.enabled) throw new Error(`探测主机未启用远程 Pull 凭据：${host.ip}`)
  if (host.os === 'Windows' && host.pullCredential.authType !== '密码') throw new Error(`Windows WinRM 当前仅支持密码认证：${host.ip}`)
}

export async function assertProbeHostReady(hostId: string) {
  const host = await prisma.host.findUnique({ where: { id: hostId }, include: { pullCredential: true } })
  if (!host) throw new Error(`探测主机不存在：${hostId}`)
  assertUsableProbeHost(host)
  return toSummary(host)
}

export async function loadProbeHostConnection(hostId: string, timeoutMs: number): Promise<{ host: ProbeHostSummary; connection: RemoteConnectionInput }> {
  const host = await prisma.host.findUnique({ where: { id: hostId }, include: { pullCredential: true } })
  if (!host) throw new Error(`探测主机不存在：${hostId}`)
  assertUsableProbeHost(host)
  const typedHost = host as HostWithCredential
  const secret = decryptSecret(typedHost.pullCredential)
  return {
    host: toSummary(typedHost),
    connection: {
      host: typedHost.ip,
      port: typedHost.pullCredential.sshPort,
      username: typedHost.pullCredential.sshUsername,
      authType: typedHost.pullCredential.authType as RemoteConnectionInput['authType'],
      password: typedHost.pullCredential.authType === '密码' ? secret : undefined,
      privateKey: typedHost.pullCredential.authType === '密钥' ? secret : undefined,
      os: typedHost.os as RemoteConnectionInput['os'],
      timeoutMs,
    },
  }
}
