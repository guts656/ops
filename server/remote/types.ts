import type { Buffer } from 'node:buffer'
import type { AuthType, OsType } from '../types/host'

export type RemoteTransport = 'ssh' | 'winrm'
export type AgentOperation = 'test_connection' | 'install_agent' | 'reinstall_agent' | 'restart_agent' | 'remanage'

export interface RemoteConnectionInput {
  host: string
  port: number
  username: string
  authType: AuthType
  password?: string
  privateKey?: string
  os: OsType
  timeoutMs?: number
}

export interface RemoteCommandResult {
  success: boolean
  stdout: string
  stderr: string
  summary: string
  hostname?: string
  osVersion?: string
  timedOut?: boolean
  timeoutMs?: number
}

export interface RemoteFileUploadResult extends RemoteCommandResult {
  remotePath: string
  bytes: number
}

export interface RemoteFileDownloadResult extends RemoteCommandResult {
  remotePath: string
  bytes: number
  content?: Buffer
}

export interface AgentInstallOptions {
  hostId: string
  agentToken: string
  apiBaseUrl: string
  intervalSeconds: number
}

export interface AgentBackendCandidateResult {
  baseUrl: string
  reachable: boolean
  httpCode: number
  exitCode: number
  message: string
}

export interface RemoteMetricsResult extends RemoteCommandResult {
  cpu?: number
  memory?: number
  disk?: number
  hostname?: string
  osVersion?: string
  uptimeSeconds?: number
}

export interface AgentOperationResult extends RemoteCommandResult {
  status: 'success' | 'failed'
}
