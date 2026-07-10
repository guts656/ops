export type SelfHealingPriority = 'P0' | 'P1' | 'P2' | 'P3'
export type SelfHealingLogic = 'AND' | 'OR'
export type SelfHealingDataSource = '指标' | '事件' | '日志'
export type SelfHealingOperator = '>' | '>=' | '<' | '<=' | '=='
export type SelfHealingTimeUnit = '秒' | '分钟'
export type SelfHealingActionType = '启动服务' | '重启服务' | '扩缩容' | '执行脚本' | '发通知'
export type SelfHealingChannel = '钉钉' | '企业微信' | '邮件'
export type SelfHealingStatus = '成功' | '失败' | '执行中'
export type SelfHealingExecutionMode = 'safe' | 'controlled'

export interface SelfHealingCondition {
  dataSource: SelfHealingDataSource
  metric: string
  service: string
  operator: SelfHealingOperator
  threshold: number
  windowValue: number
  windowUnit: SelfHealingTimeUnit
  intervalValue: number
  intervalUnit: SelfHealingTimeUnit
}

export interface SelfHealingAction {
  type: SelfHealingActionType
  target: string
  targetHostId?: string
  targetServiceId?: string
  targetServiceName?: string
  retries?: number
  cooldown?: number
}

export interface SelfHealingNotification {
  channels: SelfHealingChannel[]
  receivers: string
  template: string
}

export interface SelfHealingActionResult {
  action: SelfHealingActionType
  target: string
  status: '成功' | '失败' | '跳过'
  summary: string
  hostId?: string
  serviceId?: string
  serviceName?: string
  agentJobId?: string
  attempts?: number
}

export interface SelfHealingRule {
  id: string
  name: string
  description: string
  priority: SelfHealingPriority
  enabled: boolean
  autoExecute: boolean
  executionMode: SelfHealingExecutionMode
  triggerCount: number
  successRate: number
  lastExecutedAt: string
  logic: SelfHealingLogic
  conditions: SelfHealingCondition[]
  actions: SelfHealingAction[]
  notification: SelfHealingNotification
  conditionText: string
}

export type SelfHealingRuleValues = Omit<SelfHealingRule, 'id' | 'triggerCount' | 'successRate' | 'lastExecutedAt' | 'conditionText'>

export interface SelfHealingExecution {
  id: string
  ruleId: string
  ruleName: string
  service: string
  status: SelfHealingStatus
  triggeredAt: string
  triggerValue: string
  duration: string
  logs: string[]
  mode: SelfHealingExecutionMode
  actionResults: SelfHealingActionResult[]
  agentJobIds: string[]
  alertId?: string
}
