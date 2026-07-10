import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import type { SelfHealingExecution, SelfHealingRule, SelfHealingRuleValues } from '../../src/types/selfHealing'

function buildRuleConditionText(rule: Pick<SelfHealingRule, 'conditions' | 'logic'>) {
  return rule.conditions
    .map((condition) => `${condition.service}.${condition.metric} ${condition.operator} ${condition.threshold}（${condition.windowValue}${condition.windowUnit}）`)
    .join(` ${rule.logic} `)
}

function nowText() {
  return new Date().toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}

function maxCooldownMinutes(rule: Pick<SelfHealingRule, 'actions'>) {
  return Math.max(0, ...rule.actions.map((action) => Number(action.cooldown) || 0))
}

type RuleRow = NonNullable<Awaited<ReturnType<typeof prisma.selfHealingRule.findFirst>>>
type ExecutionRow = NonNullable<Awaited<ReturnType<typeof prisma.selfHealingExecution.findFirst>>>

function toRule(rule: RuleRow): SelfHealingRule {
  const value = {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    priority: rule.priority as SelfHealingRule['priority'],
    enabled: rule.enabled,
    autoExecute: Boolean(rule.autoExecute),
    executionMode: (rule.executionMode || 'safe') as SelfHealingRule['executionMode'],
    triggerCount: rule.triggerCount,
    successRate: rule.successRate,
    lastExecutedAt: rule.lastExecutedAt,
    logic: rule.logic as SelfHealingRule['logic'],
    conditions: rule.conditions as unknown as SelfHealingRule['conditions'],
    actions: rule.actions as unknown as SelfHealingRule['actions'],
    notification: rule.notification as unknown as SelfHealingRule['notification'],
  }
  return { ...value, conditionText: buildRuleConditionText(value) }
}

function toExecution(execution: ExecutionRow): SelfHealingExecution {
  return {
    id: execution.id,
    ruleId: execution.ruleId,
    ruleName: execution.ruleName,
    service: execution.service,
    status: execution.status as SelfHealingExecution['status'],
    triggeredAt: execution.triggeredAt,
    triggerValue: execution.triggerValue,
    duration: execution.duration,
    logs: execution.logs,
    mode: (execution.mode || 'safe') as SelfHealingExecution['mode'],
    actionResults: execution.actionResults as unknown as SelfHealingExecution['actionResults'],
    agentJobIds: execution.agentJobIds,
    alertId: execution.alertId ?? undefined,
  }
}

function ruleData(values: SelfHealingRuleValues) {
  return {
    name: values.name,
    description: values.description ?? '',
    priority: values.priority,
    enabled: values.enabled ?? true,
    autoExecute: values.autoExecute ?? false,
    executionMode: values.autoExecute && values.executionMode === 'controlled' ? 'controlled' : 'safe',
    logic: values.logic,
    conditions: values.conditions as unknown as Prisma.InputJsonValue,
    actions: values.actions as unknown as Prisma.InputJsonValue,
    notification: values.notification as unknown as Prisma.InputJsonValue,
  }
}

async function writeAudit(operator: string, action: string, target: string, detail: string) {
  await prisma.auditLog.create({ data: { operator, action, target, result: '成功', detail } })
}

export async function querySelfHealingRules() {
  const rules = await prisma.selfHealingRule.findMany({ orderBy: { createdAt: 'desc' } })
  return rules.map(toRule)
}

export async function getSelfHealingRule(id: string) {
  const rule = await prisma.selfHealingRule.findUnique({ where: { id } })
  return rule ? toRule(rule) : undefined
}

export async function createSelfHealingRule(values: SelfHealingRuleValues, operator: string) {
  const rule = await prisma.selfHealingRule.create({
    data: {
      id: `heal-${Date.now().toString(36)}`,
      triggerCount: 0,
      successRate: 100,
      lastExecutedAt: '尚未执行',
      ...ruleData(values),
    },
  })
  await writeAudit(operator, '创建自愈规则', rule.name, `优先级 ${rule.priority}，动作数 ${toRule(rule).actions.length}`)
  return toRule(rule)
}

export async function updateSelfHealingRule(id: string, values: SelfHealingRuleValues, operator: string) {
  const current = await getSelfHealingRule(id)
  if (!current) return undefined
  const rule = await prisma.selfHealingRule.update({ where: { id }, data: ruleData(values) as Prisma.SelfHealingRuleUpdateInput })
  await writeAudit(operator, '编辑自愈规则', rule.name, `状态 ${rule.enabled ? '启用' : '停用'}，条件数 ${toRule(rule).conditions.length}`)
  return toRule(rule)
}

export async function setSelfHealingRuleEnabled(id: string, enabled: boolean, operator: string) {
  const current = await getSelfHealingRule(id)
  if (!current) return undefined
  const rule = await prisma.selfHealingRule.update({ where: { id }, data: { enabled } })
  await writeAudit(operator, enabled ? '启用自愈规则' : '停用自愈规则', rule.name, `规则状态变更为${enabled ? '启用' : '停用'}`)
  return toRule(rule)
}

export async function copySelfHealingRule(id: string, operator: string) {
  const current = await getSelfHealingRule(id)
  if (!current) return undefined
  const rule = await prisma.selfHealingRule.create({
    data: {
      id: `heal-copy-${Date.now().toString(36)}`,
      name: `${current.name} 副本`,
      description: current.description,
      priority: current.priority,
      enabled: false,
      autoExecute: false,
      executionMode: 'safe',
      triggerCount: 0,
      successRate: 100,
      lastExecutedAt: '尚未执行',
      logic: current.logic,
      conditions: current.conditions as unknown as Prisma.InputJsonValue,
      actions: current.actions as unknown as Prisma.InputJsonValue,
      notification: current.notification as unknown as Prisma.InputJsonValue,
    },
  })
  await writeAudit(operator, '复制自愈规则', rule.name, `来源规则 ${current.name}`)
  return toRule(rule)
}

export async function deleteSelfHealingRule(id: string, operator: string) {
  const current = await getSelfHealingRule(id)
  if (!current) return undefined
  await prisma.selfHealingRule.delete({ where: { id } })
  await writeAudit(operator, '删除自愈规则', current.name, '删除规则并级联删除执行历史')
  return current
}

export async function querySelfHealingHistory(filters: { ruleId?: string }) {
  const history = await prisma.selfHealingExecution.findMany({
    where: { ruleId: filters.ruleId },
    orderBy: { createdAt: 'desc' },
  })
  return history.map(toExecution)
}

interface ExecutionRecordOptions {
  mode?: SelfHealingExecution['mode']
  actionResults?: SelfHealingExecution['actionResults']
  agentJobIds?: string[]
  auditDetail?: string
}

async function writeExecution(rule: SelfHealingRule, service: string, status: SelfHealingExecution['status'], triggerValue: string, logs: string[], duration: string, alertId?: string, options: ExecutionRecordOptions = {}) {
  const now = nowText()
  const execution = await prisma.selfHealingExecution.create({
    data: {
      id: `exec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      ruleId: rule.id,
      ruleName: rule.name,
      service,
      status,
      triggeredAt: now,
      triggerValue,
      duration,
      logs,
      mode: options.mode ?? 'safe',
      actionResults: (options.actionResults ?? []) as unknown as Prisma.InputJsonValue,
      agentJobIds: options.agentJobIds ?? [],
      alertId,
    },
  })
  const total = rule.triggerCount + 1
  const successCount = Math.round((rule.triggerCount * rule.successRate) / 100) + (status === '成功' ? 1 : 0)
  await prisma.selfHealingRule.update({
    where: { id: rule.id },
    data: { triggerCount: total, successRate: Math.round((successCount / total) * 100), lastExecutedAt: now },
  })
  return toExecution(execution)
}

export async function getSelfHealingExecutionSuppression(rule: Pick<SelfHealingRule, 'id' | 'actions'>, service: string, status: SelfHealingExecution['status'], triggerValue: string) {
  const cooldown = maxCooldownMinutes(rule)
  if (status === '成功' && cooldown > 0) {
    const recent = await prisma.selfHealingExecution.findFirst({
      where: { ruleId: rule.id, service, status: '成功', createdAt: { gte: new Date(Date.now() - cooldown * 60_000) } },
      orderBy: { createdAt: 'desc' },
    })
    if (recent) return `冷却期内已存在成功执行记录：${cooldown} 分钟内不重复执行`
  }

  const duplicate = await prisma.selfHealingExecution.findFirst({
    where: { ruleId: rule.id, service, triggerValue, createdAt: { gte: new Date(Date.now() - 30_000) } },
    orderBy: { createdAt: 'desc' },
  })
  if (duplicate) return '30 秒去重窗口内已记录相同触发值'

  return undefined
}

export async function recordSelfHealingExecutionFromEvaluator(rule: SelfHealingRule, service: string, status: SelfHealingExecution['status'], triggerValue: string, logs: string[], duration = '0ms', alertId?: string, options: ExecutionRecordOptions = {}) {
  const suppression = await getSelfHealingExecutionSuppression(rule, service, status, triggerValue)
  if (suppression) return undefined

  const execution = await writeExecution(rule, service, status, triggerValue, logs, duration, alertId, options)
  const detail = options.auditDetail ?? (options.mode === 'controlled'
    ? `受控执行${status === '成功' ? '完成' : '失败'}，Agent Job：${(options.agentJobIds ?? []).join(', ') || '无'}`
    : status === '成功' ? '安全模式记录计划动作，未执行远程命令' : `评估失败：${triggerValue}`)
  await writeAudit('system', '自愈规则评估', rule.name, detail)
  return execution
}

export async function createSelfHealingExecution(ruleId: string, status: SelfHealingExecution['status'], triggerValue: string, logs: string[], operator: string) {
  const rule = await getSelfHealingRule(ruleId)
  if (!rule) return undefined
  const execution = await writeExecution(rule, rule.conditions[0]?.service ?? '-', status, triggerValue, logs, '0s')
  await writeAudit(operator, '记录自愈执行', rule.name, `执行结果 ${status}`)
  return execution
}
