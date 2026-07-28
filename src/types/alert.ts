export type AlertLevel = '紧急' | '严重' | '警告' | '提示'
export type AlertStatus = '待处理' | '处理中' | '已解决'

export interface AlertItem {
  id: string
  level: AlertLevel
  time: string
  service: string
  content: string
  owner: string
  status: AlertStatus
  diagnosis?: string
  acknowledgedAt?: string
  resolvedAt?: string
  source: string
  title?: string
  metadata: Record<string, unknown>
  fingerprint?: string
  occurrenceCount: number
  firstOccurrenceAt?: string
  lastOccurrenceAt?: string
  isSuppressed: boolean
  suppressionReason?: string
  suppressionUntil?: string
  relatedType?: string
  relatedId?: string
  hostTargets?: Array<{ id: string; ip: string; hostname: string; tags: string[]; group?: string }>
  createdAt?: string
  updatedAt?: string
}

export interface AlertFilters {
  level?: AlertLevel
  status?: AlertStatus
  service?: string
  keyword?: string
  source?: string
  active?: boolean
  includeSuppressed?: boolean
  isSuppressed?: boolean
  startTime?: string
  endTime?: string
  page?: number
  pageSize?: number
}

export interface AlertPage {
  data: AlertItem[]
  page: number
  pageSize: number
  total: number
}

export interface CreateAlertInput {
  level?: AlertLevel
  severity?: AlertLevel | 'critical' | 'high' | 'medium' | 'low' | 'info'
  service?: string
  title?: string
  content: string
  owner?: string
  source?: string
  metadata?: Record<string, unknown>
  relatedType?: string
  relatedId?: string
}

export interface AlertDiagnosisResult {
  alertId: string
  result: string
}

export interface AlertNoiseReductionResult {
  fingerprint: string
  shouldNotify: boolean
  isDuplicate: boolean
  isSuppressed: boolean
  occurrenceCount: number
  suppressionReason?: string
  suppressionUntil?: string
}

export interface CreateAlertResult {
  alert: AlertItem
  noiseReduction: AlertNoiseReductionResult
}

export interface AlertSummary {
  total: number
  active: number
  today: number
  suppressed: number
  resolved: number
  byLevel: Record<AlertLevel, number>
  byStatus: Record<AlertStatus, number>
}

export interface AlertNoiseStats {
  totalFingerprints: number
  suppressedFingerprints: number
  totalOccurrences: number
  duplicateOccurrences: number
  noiseReductionRate: number
}

export interface SuppressedAlertRecord {
  id: string
  fingerprint: string
  source: string
  title: string
  service: string
  level: AlertLevel
  occurrenceCount: number
  firstOccurrenceAt: string
  lastOccurrenceAt: string
  isSuppressed: boolean
  suppressionReason?: string
  suppressionUntil?: string
  latestAlertId?: string
}

export interface SuppressAlertInput {
  fingerprint: string
  reason: string
  durationMinutes?: number
}
