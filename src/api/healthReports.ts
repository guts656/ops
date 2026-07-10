import type { HealthReport, HealthReportListResult } from '../types/healthReport'
import { http } from './http'

export async function listHealthReports(params: { page?: number; pageSize?: number; type?: string } = {}): Promise<HealthReportListResult> {
  const response = await http.get<{ data: HealthReportListResult }>('/health-reports', { params })
  return response.data.data
}

export async function getHealthReport(id: string): Promise<HealthReport> {
  const response = await http.get<{ data: HealthReport }>(`/health-reports/${id}`)
  return response.data.data
}

export async function generateWeeklyHealthReport(values: { weekStart?: string; force?: boolean } = {}): Promise<HealthReport> {
  const response = await http.post<{ data: HealthReport }>('/health-reports/weekly/generate', values)
  return response.data.data
}

export function healthReportPreviewUrl(id: string) {
  return `/api/health-reports/${id}/preview`
}

export async function downloadHealthReport(report: HealthReport) {
  const response = await http.get(`/health-reports/${report.id}/download`, { responseType: 'blob' })
  const url = window.URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = `${report.title}.html`.replace(/[\\/:*?"<>|]/g, '-')
  link.click()
  window.URL.revokeObjectURL(url)
}
