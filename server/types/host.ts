export type HostStatus = '在线' | '离线' | '纳管中'
export type OsType = 'Linux' | 'Windows'
export type AuthType = '密码' | '密钥'
export type AgentInstallMode = 'remote' | 'offline'
export type HostMarketType = 'CN_INTERNAL' | 'GLOBAL_EXTERNAL' | 'ALWAYS_ON'
export type HostAction = '新增主机' | '测试连接' | '编辑主机' | '删除主机' | '重新纳管' | '刷新主机信息' | '拉取主机指标' | '启用自动Pull' | '停用自动Pull' | '重新安装Agent' | '生成离线Agent包' | '重启Agent' | '更新Agent' | '诊断Agent回连' | '修复Agent回连路由' | '启动服务' | '停止服务' | '重启服务' | '删除服务记录' | '忽略服务' | '进入维护' | '退出维护' | '查看详情'
export type AgentJobType = 'test_connection' | 'install_agent' | 'reinstall_agent' | 'restart_agent' | 'update_agent' | 'remanage' | 'refresh_host_info' | 'pull_host_metrics' | 'diagnose_agent_backend' | 'repair_agent_backend_routes' | 'start_service' | 'stop_service' | 'restart_service' | 'batch_run_script'
export type AgentJobTransport = 'ssh' | 'winrm' | 'agent'
export type AgentJobStatus = 'pending' | 'running' | 'success' | 'failed'

export interface HostMaintenance {
  enabled: boolean
  active: boolean
  reason?: string
  until?: string
  startedAt?: string
  operator?: string
}

export interface HostMaintenanceValues {
  enabled: boolean
  reason?: string
  until?: string
}

export interface HostPullCredentialStatus {
  enabled: boolean
  sshUsername: string
  authType: AuthType
  sshPort: number
  intervalSeconds: number
  lastPulledAt?: string
  lastError?: string
  updatedAt: string
}

export interface HostLogCollectionPathStatus {
  path: string
  expandedPath?: string
  exists?: boolean
  matchedFiles: number
  readLines: number
  uploadedLines: number
  error?: string
  files?: string[]
}

export interface HostLogCollectionStatus {
  hostId: string
  collector: string
  status: 'ok' | 'warning' | 'error'
  sampledAt: string
  configPaths: string[]
  matchedFiles: number
  readLines: number
  uploadedLines: number
  eventLogs: number
  lastError?: string
  paths: HostLogCollectionPathStatus[]
  rawPayload?: unknown
  updatedAt: string
}

export interface Host {
  id: string
  ip: string
  hostname: string
  os: OsType
  osVersion: string
  cpu: number
  memory: number
  disk: number
  status: HostStatus
  group: string
  marketType: HostMarketType
  tags: string[]
  agentVersion: string
  agentStatus: '正常' | '异常' | '未安装' | '安装中'
  agentInstalledAt: string
  lastHeartbeat: string
  sshPort: number
  owner: string
  changeNo: string
  uptimeSeconds?: number
  maintenance: HostMaintenance
  pullCredential?: HostPullCredentialStatus
}

export interface HostResourcePoint {
  time: string
  cpu: number
  memory: number
  disk: number
}

export interface HostAuditLog {
  id: string
  time: string
  operator: string
  action: HostAction
  target: string
  result: '成功' | '失败'
  detail: string
  previousHash: string
  hash: string
  retentionUntil: string
}

export interface HostFilters {
  keyword?: string
  status?: HostStatus
  tag?: string
  group?: string
}

export interface AgentJob {
  id: string
  hostId: string
  type: AgentJobType
  transport: AgentJobTransport
  status: AgentJobStatus
  operator: string
  startedAt: string
  completedAt?: string
  summary: string
  stdout: string
  stderr: string
}

export interface AddHostFormValues {
  ips: string
  hostname?: string
  os?: OsType
  osVersion?: string
  installMode?: AgentInstallMode
  sshUsername?: string
  authType?: AuthType
  password?: string
  privateKey?: string
  sshPort?: number
  group: string
  marketType?: HostMarketType
  tags?: string[]
  changeNo?: string
}

export interface EditHostValues {
  hostname: string
  os: OsType
  osVersion: string
  sshPort: number
  group: string
  marketType: HostMarketType
  tags: string[]
}

export interface AgentBackendCandidateResult {
  baseUrl: string
  reachable: boolean
  httpCode: number
  exitCode: number
  message: string
}

export interface AgentBackendDiagnosisResult {
  candidates: AgentBackendCandidateResult[]
  recommendedUrl?: string
}
