export type IpushMonitorHolidayMode = 'ignore' | 'include' | 'exclude'
export type IpushMonitorStage = 'connect' | 'greeting' | 'login' | 'healthy'

export interface IpushMonitorTimeRange {
  start: string
  end: string
}

export interface IpushMonitorNotification {
  receivers?: string
}

export interface IpushMonitorRuleInput {
  name: string
  description?: string
  enabled?: boolean
  hostId?: string | null
  targetHost: string
  port: number
  systemCode: string
  serviceCode: string
  username: string
  password?: string
  expectedGreeting?: string
  expectedLoginResult?: string
  connectTimeoutMs?: number
  responseTimeoutMs?: number
  intervalSeconds?: number
  failureThreshold?: number
  cooldownMinutes?: number
  alertLevel?: '紧急' | '严重' | '警告' | '提示'
  daysOfWeek?: number[]
  timeRanges?: IpushMonitorTimeRange[]
  holidayMode?: IpushMonitorHolidayMode
  holidays?: string[]
  notification?: IpushMonitorNotification
}

export interface IpushMonitorRule extends Omit<Required<IpushMonitorRuleInput>, 'password' | 'hostId' | 'notification'> {
  id: string
  hostId?: string
  passwordConfigured: boolean
  notification: IpushMonitorNotification
  lastCheckedAt?: string
  lastTriggeredAt?: string
  lastHealthyAt?: string
  consecutiveFailures: number
  triggerCount: number
  lastReachable?: boolean
  lastLatencyMs?: number
  lastStage: string
  lastError?: string
  lastResponseSnippet: string
  createdAt: string
  updatedAt: string
}

export interface IpushProbeResult {
  ok: boolean
  reachable: boolean
  stage: IpushMonitorStage
  latencyMs: number
  responseSnippet: string
  errorMessage?: string
}

export interface IpushEvaluateResult extends IpushProbeResult {
  checked: boolean
  triggered: boolean
  consecutiveFailures: number
  notificationResults?: string[]
  skippedReason?: string
}

export interface IpushMonitorAlertRecord {
  id: string
  ruleId: string
  alertId: string
  stage: string
  reachable: boolean
  latencyMs?: number
  responseSnippet: string
  errorMessage: string
  notificationResults: string[]
  createdAt: string
}
