export type LogLevel = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG'

export interface AppLog {
  id: string
  time: string
  timestamp: string
  service: string
  level: LogLevel
  traceId: string
  message: string
  hostId?: string
  source?: string
  labels?: unknown
  rawPayload?: unknown
  ingestedAt?: string
}

export interface LogFilters {
  keyword?: string
  service?: string
  level?: LogLevel
  hostId?: string
  source?: string
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

export interface LogQueryResult {
  data: AppLog[]
  total: number
  page: number
  pageSize: number
}

export interface LogCollectionRule {
  id: string
  scope: 'host' | 'group'
  hostId?: string
  hostGroup?: string
  paths: string[]
  enabled: boolean
  createdAt: string
  updatedAt: string
}

export interface LogCollectionRuleInput {
  scope: 'host' | 'group'
  hostId?: string
  hostGroup?: string
  paths: string[]
  enabled?: boolean
}

export type LogMonitorHolidayMode = 'ignore' | 'include' | 'exclude'
export type LogMonitorHostScope = 'all' | 'single' | 'multiple' | 'group'
export type LogMonitorChannel = '站内告警' | '企业微信' | '钉钉'
export type LogMonitorSelfHealingAction = '启动服务' | '重启服务'
export type LogMonitorSelfHealingMode = 'safe' | 'controlled'
export type LogMonitorSelfHealingPriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface LogMonitorSelfHealingBinding {
  enabled: boolean
  actionType: LogMonitorSelfHealingAction
  targetHostId?: string
  targetServiceId?: string
  targetServiceName: string
  serviceName?: string
  autoExecute: boolean
  executionMode: LogMonitorSelfHealingMode
  retries: number
  cooldownMinutes: number
  priority?: LogMonitorSelfHealingPriority
}

export interface LogMonitorTimeRange {
  start: string
  end: string
}

export interface LogMonitorNotification {
  channels: LogMonitorChannel[]
  webhookUrl?: string
  receivers?: string
}

export interface LogMonitorRule {
  id: string
  name: string
  description: string
  enabled: boolean
  service?: string
  level?: LogLevel
  hostId?: string
  source?: string
  keywords: string[]
  threshold: number
  windowMinutes: number
  cooldownMinutes: number
  alertLevel: '紧急' | '严重' | '警告' | '提示'
  daysOfWeek: number[]
  timeRanges: LogMonitorTimeRange[]
  holidayMode: LogMonitorHolidayMode
  holidays: string[]
  notification: LogMonitorNotification
  selfHealingBinding?: LogMonitorSelfHealingBinding
  generatedSelfHealingRuleId?: string
  generatedAlertHandlingRuleId?: string
  hostScope: LogMonitorHostScope
  hostIds: string[]
  hostGroup?: string
  lastEvaluatedAt?: string
  lastTriggeredAt?: string
  triggerCount: number
  createdAt: string
  updatedAt: string
}

export interface LogMonitorRuleInput {
  name: string
  description?: string
  enabled?: boolean
  service?: string
  level?: LogLevel
  hostId?: string
  hostScope?: LogMonitorHostScope
  hostIds?: string[]
  hostGroup?: string
  source?: string
  keywords: string[]
  threshold: number
  windowMinutes: number
  cooldownMinutes?: number
  alertLevel?: LogMonitorRule['alertLevel']
  daysOfWeek?: number[]
  timeRanges?: LogMonitorTimeRange[]
  holidayMode?: LogMonitorHolidayMode
  holidays?: string[]
  notification?: LogMonitorNotification
  selfHealingBinding?: LogMonitorSelfHealingBinding
}

export interface LogMonitorAlertRecord {
  id: string
  ruleId: string
  alertId: string
  matchedCount: number
  windowStart: string
  windowEnd: string
  matchedKeywords: string[]
  sampleLogIds: string[]
  notificationResults: string[]
  createdAt: string
}

export interface Xm2SkippedItem {
  legacyIndex: number
  legacyKey?: string
  legacyName?: string
  type?: string
  mode?: string
  source?: string
  word?: string
  reason: string
}

export interface Xm2ConvertedRulePreview {
  key: string
  legacyIndex: number
  legacyKey?: string
  legacyName?: string
  sourceFile: string
  rule: LogMonitorRuleInput
  warnings: string[]
}

export interface Xm2ConvertPreviewResult {
  summary: {
    total: number
    convertible: number
    skipped: number
    invalid: number
  }
  candidates: Xm2ConvertedRulePreview[]
  skipped: Xm2SkippedItem[]
}

export interface Xm2ImportResult {
  imported: LogMonitorRule[]
  failed: Array<{
    index: number
    name?: string
    reason: string
  }>
}
