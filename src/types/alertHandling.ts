export interface AlertHandlingRule {
  id: string
  name: string
  description: string
  enabled: boolean
  priority: number
  alertSource?: string
  alertLevel?: '紧急' | '严重' | '警告' | '提示'
  titlePattern?: string
  servicePattern?: string
  matchers: Record<string, unknown>
  selfHealingRuleId: string
  selfHealingRuleName?: string
  cooldownMinutes: number
  autoExecute: boolean
  lastTriggeredAt?: string
  createdAt: string
  updatedAt: string
}

export type AlertHandlingRuleInput = Omit<AlertHandlingRule, 'id' | 'selfHealingRuleName' | 'lastTriggeredAt' | 'createdAt' | 'updatedAt'>
