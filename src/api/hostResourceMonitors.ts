import type { HostResourceEvaluateResult, HostResourceMonitorAlertRecord, HostResourceMonitorRule, HostResourceMonitorRuleInput } from '../types/hostResourceMonitor'
import { http } from './http'

export async function listHostResourceMonitorRules(): Promise<HostResourceMonitorRule[]> {
  const response = await http.get<{ data: HostResourceMonitorRule[] }>('/host-resource-monitors/rules')
  return response.data.data
}

export async function createHostResourceMonitorRule(values: HostResourceMonitorRuleInput): Promise<HostResourceMonitorRule> {
  const response = await http.post<{ data: HostResourceMonitorRule }>('/host-resource-monitors/rules', values)
  return response.data.data
}

export async function updateHostResourceMonitorRule(id: string, values: HostResourceMonitorRuleInput): Promise<HostResourceMonitorRule> {
  const response = await http.put<{ data: HostResourceMonitorRule }>(`/host-resource-monitors/rules/${id}`, values)
  return response.data.data
}

export async function deleteHostResourceMonitorRule(id: string): Promise<void> {
  await http.delete(`/host-resource-monitors/rules/${id}`)
}

export async function evaluateHostResourceMonitorRule(id: string): Promise<HostResourceEvaluateResult> {
  const response = await http.post<{ data: HostResourceEvaluateResult }>(`/host-resource-monitors/rules/${id}/evaluate`)
  return response.data.data
}

export async function listHostResourceMonitorAlerts(ruleId?: string): Promise<HostResourceMonitorAlertRecord[]> {
  const response = await http.get<{ data: HostResourceMonitorAlertRecord[] }>('/host-resource-monitors/alerts', { params: { ruleId } })
  return response.data.data
}
