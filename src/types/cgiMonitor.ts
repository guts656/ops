export type CgiMonitorMatchMode = 'contains' | 'not_contains'
export type CgiMonitorHolidayMode = 'ignore' | 'include' | 'exclude'
export type CgiMonitorChannel = '站内告警' | '企业微信' | '钉钉'

export interface CgiMonitorTimeRange {
  start: string
  end: string
}

export type CgiMonitorSelfHealingAction = '启动服务' | '重启服务'
export type CgiMonitorSelfHealingMode = 'safe' | 'controlled'
export type CgiMonitorSelfHealingPriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface CgiMonitorNotification {
  channels: CgiMonitorChannel[]
  webhookUrl?: string
  receivers?: string
}

export interface CgiMonitorSelfHealingBinding {
  enabled: boolean
  actionType: CgiMonitorSelfHealingAction
  targetHostId?: string
  targetServiceId?: string
  targetServiceName: string
  serviceName?: string
  autoExecute: boolean
  executionMode: CgiMonitorSelfHealingMode
  retries: number
  cooldownMinutes: number
  priority?: CgiMonitorSelfHealingPriority
}

export interface CgiMonitorProbeHost {
  id: string
  ip: string
  hostname: string
  os: 'Linux' | 'Windows'
}

export interface CgiMonitorRuleInput {
  name: string
  description?: string
  enabled?: boolean
  url: string
  probeHostId?: string | null
  method?: 'GET' | 'POST' | 'HEAD'
  keyword: string
  matchMode?: CgiMonitorMatchMode
  expectedStatus?: number | null
  timeoutMs?: number
  intervalSeconds?: number
  failureThreshold?: number
  cooldownMinutes?: number
  alertLevel?: '紧急' | '严重' | '警告' | '提示'
  daysOfWeek?: number[]
  timeRanges?: CgiMonitorTimeRange[]
  holidayMode?: CgiMonitorHolidayMode
  holidays?: string[]
  notification?: CgiMonitorNotification
  selfHealingBinding?: CgiMonitorSelfHealingBinding
}

export interface CgiMonitorRule extends Required<Omit<CgiMonitorRuleInput, 'expectedStatus' | 'notification' | 'timeRanges' | 'daysOfWeek' | 'holidays' | 'probeHostId' | 'selfHealingBinding'>> {
  id: string
  description: string
  enabled: boolean
  probeHostId?: string
  probeHost?: CgiMonitorProbeHost
  expectedStatus?: number
  daysOfWeek: number[]
  timeRanges: CgiMonitorTimeRange[]
  holidays: string[]
  notification: CgiMonitorNotification
  selfHealingBinding?: CgiMonitorSelfHealingBinding
  generatedSelfHealingRuleId?: string
  generatedAlertHandlingRuleId?: string
  lastCheckedAt?: string
  lastTriggeredAt?: string
  consecutiveFailures: number
  triggerCount: number
  lastStatusCode?: number
  lastLatencyMs?: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface CgiMonitorAlertRecord {
  id: string
  ruleId: string
  alertId: string
  statusCode?: number
  latencyMs?: number
  matched: boolean
  responseSnippet: string
  errorMessage: string
  notificationResults: string[]
  createdAt: string
}

export interface CgiMonitorEvaluateResult {
  checked: boolean
  triggered: boolean
  matched: boolean
  ok: boolean
  statusCode?: number
  latencyMs?: number
  responseSnippet: string
  errorMessage?: string
  consecutiveFailures: number
  notificationResults?: string[]
  skippedReason?: string
}
