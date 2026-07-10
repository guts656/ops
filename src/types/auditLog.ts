export type HashChainStatus = 'valid' | 'invalid' | 'not_applicable'
export type AuditExportFormat = 'csv' | 'json'

export interface AuditLogFilters {
  startTime?: string
  endTime?: string
  operator?: string
  actionType?: string
  resourceType?: string
  clientIp?: string
}

export interface AuditLogQuery extends AuditLogFilters {
  page: number
  pageSize: number
}

export interface AuditLogItem {
  id: string
  source: 'system' | 'host'
  time: string
  timestamp: number
  operator: string
  actionType: string
  resourceType: string
  resourceId: string
  content: string
  requestSummary: string
  clientIp: string
  hashChainStatus: HashChainStatus
}

export interface AuditLogDetail extends AuditLogItem {
  result: string
  requestBody: unknown
  responseBody: unknown
  raw: Record<string, unknown>
  hashVerification: { status: HashChainStatus; message: string }
}

export interface AuditLogOptions {
  actionTypes: string[]
  resourceTypes: string[]
}

export interface AuditLogPage {
  data: AuditLogItem[]
  total: number
  page: number
  pageSize: number
}

export interface AuditExportTask {
  id: string
  status: 'processing' | 'completed'
  format: AuditExportFormat
  fileName: string
  downloadUrl: string
  createdAt: string
  completedAt?: string
}
