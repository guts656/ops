import type { LogCollectionRule, LogCollectionRuleInput, LogFilters, LogMonitorAlertRecord, LogMonitorHostScope, LogMonitorRule, LogMonitorRuleInput, LogQueryResult, Xm2ConvertPreviewResult, Xm2ImportResult } from '../types/log'
import { http } from './http'

export async function queryLogs(filters: LogFilters): Promise<LogQueryResult> {
  const response = await http.get<LogQueryResult>('/logs', { params: filters })
  return response.data
}

export async function getLogServices(): Promise<string[]> {
  const response = await http.get<{ data: string[] }>('/logs/services')
  return response.data.data
}

export async function getHostLogs(hostId: string): Promise<LogQueryResult> {
  return queryLogs({ hostId, page: 1, pageSize: 100 })
}

export async function getLogCollectionRules(): Promise<LogCollectionRule[]> {
  const response = await http.get<{ data: LogCollectionRule[] }>('/hosts/log-collection-rules')
  return response.data.data
}

export async function saveLogCollectionRule(values: LogCollectionRuleInput): Promise<LogCollectionRule> {
  const response = await http.post<{ data: LogCollectionRule }>('/hosts/log-collection-rules', values)
  return response.data.data
}

export async function deleteLogCollectionRule(id: string): Promise<void> {
  await http.delete(`/hosts/log-collection-rules/${id}`)
}

export async function listLogMonitorRules(): Promise<LogMonitorRule[]> {
  const response = await http.get<{ data: LogMonitorRule[] }>('/logs/monitor-rules')
  return response.data.data
}

export async function createLogMonitorRule(values: LogMonitorRuleInput): Promise<LogMonitorRule> {
  const response = await http.post<{ data: LogMonitorRule }>('/logs/monitor-rules', values)
  return response.data.data
}

export async function updateLogMonitorRule(id: string, values: LogMonitorRuleInput): Promise<LogMonitorRule> {
  const response = await http.put<{ data: LogMonitorRule }>(`/logs/monitor-rules/${id}`, values)
  return response.data.data
}

export async function deleteLogMonitorRule(id: string): Promise<void> {
  await http.delete(`/logs/monitor-rules/${id}`)
}

export async function evaluateLogMonitorRule(id: string) {
  const response = await http.post<{ data: { matchedCount: number; matchedKeywords: string[]; triggered: boolean; skippedReason?: string } }>(`/logs/monitor-rules/${id}/evaluate`)
  return response.data.data
}

export async function listLogMonitorAlerts(ruleId?: string): Promise<LogMonitorAlertRecord[]> {
  const response = await http.get<{ data: LogMonitorAlertRecord[] }>('/logs/monitor-alerts', { params: { ruleId } })
  return response.data.data
}

export async function previewXm2MonitorJson(values: { rawJson?: string; content?: unknown }): Promise<Xm2ConvertPreviewResult> {
  const response = await http.post<{ data: Xm2ConvertPreviewResult }>('/logs/xm2-convert/preview', values)
  return response.data.data
}

export async function importXm2MonitorRules(values: { rules: LogMonitorRuleInput[]; hostScope: LogMonitorHostScope; hostId?: string; hostIds?: string[]; hostGroup?: string; daysOfWeek?: number[]; holidayMode?: LogMonitorRuleInput['holidayMode']; holidays?: string[] }): Promise<Xm2ImportResult> {
  const response = await http.post<{ data: Xm2ImportResult }>('/logs/xm2-convert/import', values)
  return response.data.data
}
