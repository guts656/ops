import type { CgiMonitorAlertRecord, CgiMonitorEvaluateResult, CgiMonitorRule, CgiMonitorRuleInput } from '../types/cgiMonitor'
import { http } from './http'

export async function listCgiMonitorRules(): Promise<CgiMonitorRule[]> {
  const response = await http.get<{ data: CgiMonitorRule[] }>('/cgi-monitors/rules')
  return response.data.data
}

export async function createCgiMonitorRule(values: CgiMonitorRuleInput): Promise<CgiMonitorRule> {
  const response = await http.post<{ data: CgiMonitorRule }>('/cgi-monitors/rules', values)
  return response.data.data
}

export async function updateCgiMonitorRule(id: string, values: CgiMonitorRuleInput): Promise<CgiMonitorRule> {
  const response = await http.put<{ data: CgiMonitorRule }>(`/cgi-monitors/rules/${id}`, values)
  return response.data.data
}

export async function deleteCgiMonitorRule(id: string): Promise<void> {
  await http.delete(`/cgi-monitors/rules/${id}`)
}

export async function evaluateCgiMonitorRule(id: string): Promise<CgiMonitorEvaluateResult> {
  const response = await http.post<{ data: CgiMonitorEvaluateResult }>(`/cgi-monitors/rules/${id}/evaluate`)
  return response.data.data
}

export async function listCgiMonitorAlerts(ruleId?: string): Promise<CgiMonitorAlertRecord[]> {
  const response = await http.get<{ data: CgiMonitorAlertRecord[] }>('/cgi-monitors/alerts', { params: { ruleId } })
  return response.data.data
}
