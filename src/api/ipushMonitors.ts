import type { IpushEvaluateResult, IpushMonitorAlertRecord, IpushMonitorRule, IpushMonitorRuleInput } from '../types/ipushMonitor'
import { http } from './http'

export async function listIpushMonitorRules(): Promise<IpushMonitorRule[]> {
  const response = await http.get<{ data: IpushMonitorRule[] }>('/ipush-monitors/rules')
  return response.data.data
}

export async function createIpushMonitorRule(values: IpushMonitorRuleInput): Promise<IpushMonitorRule> {
  const response = await http.post<{ data: IpushMonitorRule }>('/ipush-monitors/rules', values)
  return response.data.data
}

export async function updateIpushMonitorRule(id: string, values: IpushMonitorRuleInput): Promise<IpushMonitorRule> {
  const response = await http.put<{ data: IpushMonitorRule }>(`/ipush-monitors/rules/${id}`, values)
  return response.data.data
}

export async function deleteIpushMonitorRule(id: string): Promise<void> {
  await http.delete(`/ipush-monitors/rules/${id}`)
}

export async function evaluateIpushMonitorRule(id: string): Promise<IpushEvaluateResult> {
  const response = await http.post<{ data: IpushEvaluateResult }>(`/ipush-monitors/rules/${id}/evaluate`)
  return response.data.data
}

export async function listIpushMonitorAlerts(ruleId?: string): Promise<IpushMonitorAlertRecord[]> {
  const response = await http.get<{ data: IpushMonitorAlertRecord[] }>('/ipush-monitors/alerts', { params: { ruleId } })
  return response.data.data
}
