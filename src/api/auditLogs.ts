import type { AuditExportFormat, AuditExportTask, AuditLogDetail, AuditLogFilters, AuditLogOptions, AuditLogPage, AuditLogQuery } from '../types/auditLog'
import { http } from './http'

export async function queryAuditLogs(query: AuditLogQuery): Promise<AuditLogPage> {
  const response = await http.get<AuditLogPage>('/audit/logs', { params: query })
  return response.data
}

export async function getAuditLogOptions(): Promise<AuditLogOptions> {
  const response = await http.get<AuditLogOptions>('/audit/logs/options')
  return response.data
}

export async function getAuditLogDetail(id: string): Promise<AuditLogDetail> {
  const response = await http.get<{ data: AuditLogDetail }>(`/audit/logs/${id}`)
  return response.data.data
}

export async function exportAuditLogs(format: AuditExportFormat, filters: AuditLogFilters): Promise<AuditExportTask> {
  const response = await http.post<{ data: AuditExportTask }>('/audit/logs/export', { format, filters })
  return response.data.data
}

export async function downloadAuditExport(task: AuditExportTask) {
  const response = await http.get(task.downloadUrl.replace('/api', ''), { responseType: 'blob' })
  const url = window.URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = task.fileName
  link.click()
  window.URL.revokeObjectURL(url)
}
