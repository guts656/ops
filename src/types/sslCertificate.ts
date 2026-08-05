export type SslCertificateStatus = 'normal' | 'expiring' | 'expired' | 'failed' | 'unknown'
export type SslCertificateAlertLevel = 'none' | 'warning30' | 'warning15' | 'warning7' | 'critical'
export type SslCertificatePlatformLevel = '紧急' | '严重' | '警告' | '提示'

export interface SslCertificateNotification {
  receivers?: string
}

export interface SslCertificateMonitor {
  id: string
  name: string
  description: string
  enabled: boolean
  domain: string
  serverIp?: string
  port: number
  issuer: string
  validFrom?: string
  validTo?: string
  remainingDays: number | null
  domainMatched: boolean
  status: SslCertificateStatus
  thresholds: number[]
  checkTime: string
  alertLevel: SslCertificatePlatformLevel
  notification: SslCertificateNotification
  lastCheckedAt?: string
  nextCheckAt?: string
  lastTriggeredAt?: string
  triggerCount: number
  lastError?: string
  createdAt: string
  updatedAt: string
}

export interface SslCertificateMonitorInput {
  name: string
  description?: string
  enabled?: boolean
  domain: string
  serverIp?: string
  port?: number
  thresholds?: number[]
  checkTime?: string
  alertLevel?: SslCertificatePlatformLevel
  notification?: SslCertificateNotification
}

export interface SslCertificateHistory {
  id: string
  monitorId: string
  alertId?: string
  domain: string
  serverIp?: string
  port: number
  checkedAt: string
  status: Exclude<SslCertificateStatus, 'unknown'>
  issuer: string
  validFrom?: string
  validTo?: string
  remainingDays: number | null
  domainMatched: boolean
  alertLevel: SslCertificateAlertLevel
  matchedThreshold?: number
  notificationResults: string[]
  errorMessage?: string
  createdAt: string
}

export interface SslCertificateCheckResponse {
  monitor: SslCertificateMonitor
  history: SslCertificateHistory
  triggered: boolean
  notificationResults: string[]
}
