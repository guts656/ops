import type { AlertHandlingRule, AlertHandlingRuleInput } from '../types/alertHandling'
import { http } from './http'

export async function listAlertHandlingRules(): Promise<AlertHandlingRule[]> {
  const response = await http.get<{ data: AlertHandlingRule[] }>('/alert-handling-rules')
  return response.data.data
}

export async function createAlertHandlingRule(input: AlertHandlingRuleInput): Promise<AlertHandlingRule> {
  const response = await http.post<{ data: AlertHandlingRule }>('/alert-handling-rules', input)
  return response.data.data
}

export async function updateAlertHandlingRule(id: string, input: AlertHandlingRuleInput): Promise<AlertHandlingRule> {
  const response = await http.put<{ data: AlertHandlingRule }>(`/alert-handling-rules/${id}`, input)
  return response.data.data
}

export async function deleteAlertHandlingRule(id: string): Promise<void> {
  await http.delete(`/alert-handling-rules/${id}`)
}
