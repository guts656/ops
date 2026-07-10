import type { SelfHealingExecution, SelfHealingRule, SelfHealingRuleValues } from '../types/selfHealing'
import { http } from './http'

export async function getSelfHealingRules(): Promise<SelfHealingRule[]> {
  const response = await http.get<{ data: SelfHealingRule[] }>('/self-healing/rules')
  return response.data.data
}

export async function getSelfHealingHistory(filters: { ruleId?: string } = {}): Promise<SelfHealingExecution[]> {
  const response = await http.get<{ data: SelfHealingExecution[] }>('/self-healing/history', { params: filters })
  return response.data.data
}

export async function createSelfHealingRule(values: SelfHealingRuleValues): Promise<SelfHealingRule> {
  const response = await http.post<{ data: SelfHealingRule }>('/self-healing/rules', values)
  return response.data.data
}

export async function updateSelfHealingRule(id: string, values: SelfHealingRuleValues): Promise<SelfHealingRule> {
  const response = await http.put<{ data: SelfHealingRule }>(`/self-healing/rules/${id}`, values)
  return response.data.data
}

export async function setSelfHealingRuleEnabled(id: string, enabled: boolean): Promise<SelfHealingRule> {
  const response = await http.patch<{ data: SelfHealingRule }>(`/self-healing/rules/${id}/enabled`, { enabled })
  return response.data.data
}

export async function copySelfHealingRule(id: string): Promise<SelfHealingRule> {
  const response = await http.post<{ data: SelfHealingRule }>(`/self-healing/rules/${id}/copy`)
  return response.data.data
}

export async function deleteSelfHealingRule(id: string): Promise<{ success: boolean; id: string }> {
  const response = await http.delete<{ success: boolean; id: string }>(`/self-healing/rules/${id}`)
  return response.data
}

export async function evaluateSelfHealingRule(id: string): Promise<SelfHealingExecution | undefined> {
  const response = await http.post<{ success: boolean; data?: SelfHealingExecution }>(`/self-healing/rules/${id}/evaluate`)
  return response.data.data
}

export function buildSelfHealingLogExport(history: SelfHealingExecution[]) {
  return JSON.stringify(history, null, 2)
}
