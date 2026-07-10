import { prisma } from '../db/prisma'
import { recordSelfHealingMatch } from './selfHealingEvaluator'
import { ruleMatchesAlert } from '../data/alertHandlingRules'
import type { AlertItem } from '../types/alert'
import type { SelfHealingRule } from '../../src/types/selfHealing'
import { createNotification } from './notificationService'
import { emitSelfHealingEvent } from './realtime'

function toSelfHealingRule(rule: any): SelfHealingRule {
  return {
    id: rule.id,
    name: rule.name,
    description: rule.description,
    priority: rule.priority,
    enabled: rule.enabled,
    autoExecute: Boolean(rule.autoExecute),
    executionMode: rule.executionMode || 'safe',
    triggerCount: rule.triggerCount,
    successRate: rule.successRate,
    lastExecutedAt: rule.lastExecutedAt,
    logic: rule.logic,
    conditions: rule.conditions,
    actions: rule.actions,
    notification: rule.notification,
    conditionText: '',
  }
}

function inCooldown(lastTriggeredAt: Date | null, cooldownMinutes: number) {
  return Boolean(lastTriggeredAt && Date.now() - lastTriggeredAt.getTime() < Math.max(0, cooldownMinutes) * 60_000)
}

export async function handleAlertWithSelfHealing(alert: AlertItem) {
  if (alert.isSuppressed || alert.status === '已解决') return []
  const rules = await prisma.alertHandlingRule.findMany({
    where: { enabled: true, selfHealingRule: { enabled: true } },
    include: { selfHealingRule: true },
    orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
  })
  const executions = []

  for (const rule of rules) {
    if (!ruleMatchesAlert(rule, alert)) continue
    if (inCooldown(rule.lastTriggeredAt, rule.cooldownMinutes)) continue

    const healingRule = toSelfHealingRule(rule.selfHealingRule)
    const metadata = alert.metadata ?? {}
    const candidateHostIds = [metadata.selfHealingTargetHostId, metadata.targetHostId, metadata.hostId, metadata.sourceHostId, metadata.probeHostId]
      .map((value) => (typeof value === 'string' ? value : ''))
      .filter(Boolean)
    const executionRule = rule.autoExecute ? healingRule : { ...healingRule, autoExecute: false, executionMode: 'safe' as const }
    const execution = await recordSelfHealingMatch(executionRule, {
      service: alert.service,
      triggerValue: `告警映射触发：${alert.id}`,
      evidenceLogs: [
        `命中映射：${rule.name}${rule.autoExecute ? '（映射允许受控执行）' : '（映射安全模式）'}`,
        `告警：${alert.title || alert.content}`,
        `来源：${alert.source}，级别：${alert.level}，服务：${alert.service}`,
      ],
      candidateHostIds,
      duration: '0ms',
      alertId: alert.id,
    })
    await prisma.alertHandlingRule.update({ where: { id: rule.id }, data: { lastTriggeredAt: new Date() } })

    if (execution) {
      executions.push(execution)
      await createNotification({
        type: 'self_healing',
        level: 'success',
        title: `告警已匹配自愈规则：${healingRule.name}`,
        content: `${alert.service} 的告警已生成自愈执行记录（${execution.mode === 'controlled' ? '受控执行' : '安全模式'}）。`,
        entityType: 'selfHealingExecution',
        entityId: execution.id,
        metadata: { alertId: alert.id, ruleId: healingRule.id, mappingId: rule.id },
      })
      emitSelfHealingEvent({ alertId: alert.id, ruleId: healingRule.id, execution })
    }
    break
  }

  return executions
}
