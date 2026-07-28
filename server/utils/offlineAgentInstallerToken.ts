import jwt from 'jsonwebtoken'
import { jwtSecret } from '../config/env'

const OFFLINE_AGENT_INSTALLER_PURPOSE = 'windows-offline-agent-install'

interface OfflineAgentInstallerPayload {
  purpose: typeof OFFLINE_AGENT_INSTALLER_PURPOSE
  hostId: string
  hostIp: string
  apiBaseUrl: string
}

export function signOfflineAgentInstallerToken(payload: Omit<OfflineAgentInstallerPayload, 'purpose'>) {
  return jwt.sign({ ...payload, purpose: OFFLINE_AGENT_INSTALLER_PURPOSE }, jwtSecret, { expiresIn: '7d' })
}

export function verifyOfflineAgentInstallerToken(token: string) {
  const payload = jwt.verify(token, jwtSecret) as Partial<OfflineAgentInstallerPayload>
  if (payload.purpose !== OFFLINE_AGENT_INSTALLER_PURPOSE || !payload.hostId || !payload.hostIp || !payload.apiBaseUrl) {
    throw new Error('离线 Agent 安装令牌无效')
  }
  return {
    hostId: payload.hostId,
    hostIp: payload.hostIp,
    apiBaseUrl: payload.apiBaseUrl,
  }
}
