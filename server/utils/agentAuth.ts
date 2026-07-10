import type { Request } from 'express'
import { prisma } from '../db/prisma'
import { verifyAgentToken } from './agentToken'

function bearer(value: string | undefined) {
  const match = value?.match(/^Bearer\s+(.+)$/i)
  return match?.[1]
}

export async function authenticateAgentHost(req: Request) {
  const host = await prisma.host.findUnique({ where: { id: req.params.id } })
  if (!host) return { status: 404, message: '主机不存在' as const }
  if (!host.agentTokenHash) return { status: 401, message: 'Agent 未注册' as const }

  const token = bearer(req.headers.authorization)
  if (!token || !verifyAgentToken(token, host.agentTokenHash)) return { status: 401, message: 'Agent 认证失败' as const }

  return { host }
}

export async function touchAgentHeartbeat(hostId: string) {
  await prisma.host.update({ where: { id: hostId }, data: { status: '在线', agentStatus: '正常', lastHeartbeat: new Date().toLocaleString('zh-CN', { hour12: false }) } })
}
