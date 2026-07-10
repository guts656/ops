import type { LogMonitorChannel, LogMonitorHostScope, LogMonitorTimeRange } from './log'

export type { LogMonitorTimeRange }
export type HostResourceMetric = 'cpu' | 'memory' | 'disk'
export type HostResourceAlertLevel = '紧急' | '严重' | '警告' | '提示'
export type HostResourceHolidayMode = 'ignore' | 'include' | 'exclude'

export interface HostResourceMonitorNotification {
  channels: LogMonitorChannel[]
  webhookUrl?: string
  receivers?: string
}

export interface HostResourceMonitorRule {
  id: string
  name: string
  description: string
  enabled: boolean
  hostId?: string
  hostScope: LogMonitorHostScope
  hostIds: string[]
  hostGroup?: string
  metrics: HostResourceMetric[]
  threshold: number
  cooldownMinutes: number
  alertLevel: HostResourceAlertLevel
  daysOfWeek: number[]
  timeRanges: LogMonitorTimeRange[]
  holidayMode: HostResourceHolidayMode
  holidays: string[]
  notification: HostResourceMonitorNotification
  lastEvaluatedAt?: string
  lastTriggeredAt?: string
  triggerCount: number
  createdAt: string
  updatedAt: string
}

export interface HostResourceMonitorRuleInput {
  name: string
  description?: string
  enabled?: boolean
  hostId?: string
  hostScope?: LogMonitorHostScope
  hostIds?: string[]
  hostGroup?: string
  metrics?: HostResourceMetric[]
  threshold?: number
  cooldownMinutes?: number
  alertLevel?: HostResourceAlertLevel
  daysOfWeek?: number[]
  timeRanges?: LogMonitorTimeRange[]
  holidayMode?: HostResourceHolidayMode
  holidays?: string[]
  notification?: HostResourceMonitorNotification
}

export interface HostResourceMonitorAlertRecord {
  id: string
  ruleId: string
  alertId: string
  hostId: string
  metric: HostResourceMetric
  value: number
  threshold: number
  sampledAt: string
  notificationResults: string[]
  createdAt: string
}

export interface HostResourceEvaluateResult {
  rule: HostResourceMonitorRule
  evaluated: number
  triggered: number
  skippedReason?: string
}
