import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'

export type MonitorSelfHealingAction = '启动服务' | '重启服务'
export type MonitorSelfHealingMode = 'safe' | 'controlled'
export type MonitorSelfHealingPriority = 'P0' | 'P1' | 'P2' | 'P3'

export interface MonitorSelfHealingBinding {
  enabled: boolean
  actionType: MonitorSelfHealingAction
  targetHostId?: string
  targetServiceId?: string
  targetServiceName: string
  serviceName?: string
  autoExecute: boolean
  executionMode: MonitorSelfHealingMode
  retries: number
  cooldownMinutes: number
  priority?: MonitorSelfHealingPriority
}

export interface SyncMonitorSelfHealingBindingInput {
  monitorType: 'cgi' | 'log'
  alertSource: 'CGI监控' | '日志监控'
  relatedType: 'cgi_monitor_rule' | 'log_monitor_rule'
  ruleId: string
  ruleName: string
  enabled: boolean
  alertLevel: '紧急' | '严重' | '警告' | '提示' | string
  cooldownMinutes: number
  binding: unknown
  conditionMetric: string
  conditionService: string
  conditionIntervalSeconds?: number
  description: string
  notificationReceivers?: string
  generatedSelfHealingRuleId?: string | null
  generatedAlertHandlingRuleId?: string | null
}

export interface SyncedMonitorSelfHealingBindingIds {
  generatedSelfHealingRuleId?: string
  generatedAlertHandlingRuleId?: string
}

const priorities = new Set(['P0', 'P1', 'P2', 'P3'])

function clampInt(value: unknown, fallback: number, min: number, max: number) {
  const next = Math.floor(Number(value ?? fallback))
  if (!Number.isFinite(next)) return fallback
  return Math.min(max, Math.max(min, next))
}

function stringValue(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

export function normalizeMonitorSelfHealingBinding(value: unknown, fallbackCooldown: number): MonitorSelfHealingBinding | undefined {
  const binding = value as Partial<MonitorSelfHealingBinding & { serviceName?: string }> | undefined
  if (!binding) return undefined
  const enabled = Boolean(binding.enabled)
  const actionType = binding.actionType === '启动服务' ? '启动服务' : '重启服务'
  const targetServiceName = stringValue(binding.targetServiceName) || stringValue(binding.serviceName)
  const targetHostId = stringValue(binding.targetHostId) || undefined
  const targetServiceId = stringValue(binding.targetServiceId) || undefined
  const retries = clampInt(binding.retries, 0, 0, 2)
  const cooldownMinutes = clampInt(binding.cooldownMinutes, fallbackCooldown, 1, 1440)
  const autoExecute = Boolean(binding.autoExecute)
  const executionMode = autoExecute && binding.executionMode === 'controlled' ? 'controlled' : 'safe'
  const priority = priorities.has(String(binding.priority)) ? binding.priority as MonitorSelfHealingPriority : undefined
  return {
    enabled,
    actionType,
    targetHostId,
    targetServiceId,
    targetServiceName,
    serviceName: targetServiceName,
    autoExecute,
    executionMode,
    retries,
    cooldownMinutes,
    priority,
  }
}

export async function validateMonitorSelfHealingBinding(binding: MonitorSelfHealingBinding | undefined) {
  if (!binding?.enabled) return
  if (!binding.targetServiceName && !binding.targetServiceId) throw new Error('启用异常自愈时必须填写目标服务')
  if (binding.targetHostId) {
    const host = await prisma.host.findUnique({ where: { id: binding.targetHostId }, select: { id: true } })
    if (!host) throw new Error('自愈目标主机不存在')
  }
  if (binding.targetServiceId) {
    const service = await prisma.hostService.findUnique({ where: { id: binding.targetServiceId }, select: { id: true, hostId: true, name: true } })
    if (!service) throw new Error('自愈目标服务不存在')
    if (binding.targetHostId && service.hostId !== binding.targetHostId) throw new Error('自愈目标服务不属于所选目标主机')
    if (!binding.targetServiceName) binding.targetServiceName = service.name
    binding.serviceName = binding.targetServiceName
  }
}

export async function normalizeAndValidateMonitorSelfHealingBinding(value: unknown, fallbackCooldown: number) {
  const binding = normalizeMonitorSelfHealingBinding(value, fallbackCooldown)
  await validateMonitorSelfHealingBinding(binding)
  return binding
}

function generatedRulePriority(alertLevel: string, binding: MonitorSelfHealingBinding) {
  if (binding.priority) return binding.priority
  if (alertLevel === '紧急') return 'P0'
  if (alertLevel === '严重') return 'P1'
  if (alertLevel === '提示') return 'P3'
  return 'P2'
}

function generatedEnabled(input: SyncMonitorSelfHealingBindingInput, binding: MonitorSelfHealingBinding) {
  return Boolean(input.enabled && binding.enabled)
}

function generatedSelfHealingData(input: SyncMonitorSelfHealingBindingInput, binding: MonitorSelfHealingBinding) {
  return {
    name: `${input.monitorType === 'cgi' ? 'URL异常自愈' : '日志异常自愈'}：${input.ruleName}`,
    description: input.description,
    priority: generatedRulePriority(input.alertLevel, binding),
    enabled: generatedEnabled(input, binding),
    autoExecute: Boolean(binding.autoExecute),
    executionMode: binding.autoExecute && binding.executionMode === 'controlled' ? 'controlled' : 'safe',
    logic: 'OR',
    conditions: [{
      dataSource: input.monitorType === 'log' ? '日志' : '事件',
      metric: input.conditionMetric,
      service: input.conditionService,
      operator: '>=',
      threshold: 1,
      windowValue: Math.max(1, binding.cooldownMinutes),
      windowUnit: '分钟',
      intervalValue: Math.max(10, input.conditionIntervalSeconds ?? 30),
      intervalUnit: '秒',
    }],
    actions: [{
      type: binding.actionType,
      target: binding.targetServiceName,
      targetHostId: binding.targetHostId,
      targetServiceId: binding.targetServiceId,
      targetServiceName: binding.targetServiceName,
      retries: binding.retries,
      cooldown: binding.cooldownMinutes,
    }],
    notification: {
      channels: [],
      receivers: input.notificationReceivers || '',
      template: `${input.monitorType === 'cgi' ? 'URL' : '日志'}监控 ${input.ruleName} 异常，已触发自愈动作。`,
    },
  }
}

function generatedAlertHandlingData(input: SyncMonitorSelfHealingBindingInput, selfHealingRuleId: string, binding: MonitorSelfHealingBinding) {
  return {
    name: `${input.monitorType === 'cgi' ? 'URL异常映射' : '日志异常映射'}：${input.ruleName}`,
    description: `由${input.monitorType === 'cgi' ? ' CGI/URL' : '日志'}监控「${input.ruleName}」自动生成，请优先从监控规则维护。`,
    enabled: generatedEnabled(input, binding),
    priority: 100,
    alertSource: input.alertSource,
    alertLevel: input.alertLevel,
    titlePattern: null,
    servicePattern: null,
    matchers: { ruleId: input.ruleId } as unknown as Prisma.InputJsonValue,
    selfHealingRuleId,
    cooldownMinutes: binding.cooldownMinutes,
    autoExecute: Boolean(binding.autoExecute),
  }
}

export async function disableGeneratedMonitorSelfHealingBinding(ids: Pick<SyncMonitorSelfHealingBindingInput, 'generatedSelfHealingRuleId' | 'generatedAlertHandlingRuleId'>) {
  if (ids.generatedAlertHandlingRuleId) await prisma.alertHandlingRule.updateMany({ where: { id: ids.generatedAlertHandlingRuleId }, data: { enabled: false, autoExecute: false } })
  if (ids.generatedSelfHealingRuleId) await prisma.selfHealingRule.updateMany({ where: { id: ids.generatedSelfHealingRuleId }, data: { enabled: false, autoExecute: false, executionMode: 'safe' } })
}

export async function syncMonitorSelfHealingBinding(input: SyncMonitorSelfHealingBindingInput): Promise<SyncedMonitorSelfHealingBindingIds> {
  const binding = await normalizeAndValidateMonitorSelfHealingBinding(input.binding, input.cooldownMinutes)
  if (!binding?.enabled) {
    await disableGeneratedMonitorSelfHealingBinding(input)
    return {}
  }

  const selfHealingId = input.generatedSelfHealingRuleId || `heal-${input.monitorType}-${input.ruleId}`
  const selfHealingData = generatedSelfHealingData(input, binding)
  const existingSelfHealing = await prisma.selfHealingRule.findUnique({ where: { id: selfHealingId } })
  if (existingSelfHealing) {
    await prisma.selfHealingRule.update({ where: { id: selfHealingId }, data: selfHealingData as Prisma.SelfHealingRuleUpdateInput })
  } else {
    await prisma.selfHealingRule.create({
      data: {
        id: selfHealingId,
        triggerCount: 0,
        successRate: 100,
        lastExecutedAt: '尚未执行',
        ...selfHealingData,
        conditions: selfHealingData.conditions as unknown as Prisma.InputJsonValue,
        actions: selfHealingData.actions as unknown as Prisma.InputJsonValue,
        notification: selfHealingData.notification as unknown as Prisma.InputJsonValue,
      },
    })
  }

  let alertHandlingId = input.generatedAlertHandlingRuleId || undefined
  const alertHandlingData = generatedAlertHandlingData(input, selfHealingId, binding)
  if (alertHandlingId) {
    const updated = await prisma.alertHandlingRule.updateMany({ where: { id: alertHandlingId }, data: alertHandlingData })
    if (!updated.count) alertHandlingId = undefined
  }
  if (!alertHandlingId) {
    const mapping = await prisma.alertHandlingRule.create({ data: alertHandlingData as Prisma.AlertHandlingRuleUncheckedCreateInput })
    alertHandlingId = mapping.id
  }

  return { generatedSelfHealingRuleId: selfHealingId, generatedAlertHandlingRuleId: alertHandlingId }
}
