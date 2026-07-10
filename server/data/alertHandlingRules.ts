import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import type { AlertItem } from '../types/alert'

export interface AlertHandlingRuleInput {
  name: string
  description?: string
  enabled?: boolean
  priority?: number
  alertSource?: string
  alertLevel?: string
  titlePattern?: string
  servicePattern?: string
  matchers?: Record<string, unknown>
  selfHealingRuleId: string
  cooldownMinutes?: number
  autoExecute?: boolean
}

function toRule(row: any) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    priority: row.priority,
    alertSource: row.alertSource ?? undefined,
    alertLevel: row.alertLevel ?? undefined,
    titlePattern: row.titlePattern ?? undefined,
    servicePattern: row.servicePattern ?? undefined,
    matchers: row.matchers && typeof row.matchers === 'object' ? row.matchers : {},
    selfHealingRuleId: row.selfHealingRuleId,
    selfHealingRuleName: row.selfHealingRule?.name,
    cooldownMinutes: row.cooldownMinutes,
    autoExecute: row.autoExecute,
    lastTriggeredAt: row.lastTriggeredAt?.toISOString?.(),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function data(input: AlertHandlingRuleInput): Prisma.AlertHandlingRuleUncheckedCreateInput | Prisma.AlertHandlingRuleUncheckedUpdateInput {
  return {
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    enabled: input.enabled ?? true,
    priority: input.priority ?? 100,
    alertSource: input.alertSource?.trim() || null,
    alertLevel: input.alertLevel || null,
    titlePattern: input.titlePattern?.trim() || null,
    servicePattern: input.servicePattern?.trim() || null,
    matchers: (input.matchers ?? {}) as Prisma.InputJsonValue,
    selfHealingRuleId: input.selfHealingRuleId,
    cooldownMinutes: input.cooldownMinutes ?? 30,
    autoExecute: input.autoExecute ?? false,
  }
}

export async function listAlertHandlingRules() {
  const rows = await prisma.alertHandlingRule.findMany({ orderBy: [{ priority: 'asc' }, { createdAt: 'desc' }], include: { selfHealingRule: { select: { name: true } } } })
  return rows.map(toRule)
}

export async function createAlertHandlingRule(input: AlertHandlingRuleInput) {
  const row = await prisma.alertHandlingRule.create({ data: data(input) as Prisma.AlertHandlingRuleUncheckedCreateInput, include: { selfHealingRule: { select: { name: true } } } })
  return toRule(row)
}

export async function updateAlertHandlingRule(id: string, input: AlertHandlingRuleInput) {
  const row = await prisma.alertHandlingRule.update({ where: { id }, data: data(input) as Prisma.AlertHandlingRuleUncheckedUpdateInput, include: { selfHealingRule: { select: { name: true } } } })
  return toRule(row)
}

export async function deleteAlertHandlingRule(id: string) {
  await prisma.alertHandlingRule.delete({ where: { id } })
}

function contains(value: string | undefined, pattern: string | null) {
  if (!pattern) return true
  return (value ?? '').toLowerCase().includes(pattern.toLowerCase())
}

export function ruleMatchesAlert(rule: any, alert: AlertItem) {
  if (rule.alertSource && rule.alertSource !== alert.source) return false
  if (rule.alertLevel && rule.alertLevel !== alert.level) return false
  if (!contains(alert.title || alert.content, rule.titlePattern)) return false
  if (!contains(alert.service, rule.servicePattern)) return false
  const matchers = rule.matchers && typeof rule.matchers === 'object' ? rule.matchers as Record<string, unknown> : {}
  for (const [key, expected] of Object.entries(matchers)) {
    if (expected === undefined || expected === null || expected === '') continue
    const actual = alert.metadata?.[key]
    if (String(actual ?? '').toLowerCase() !== String(expected).toLowerCase()) return false
  }
  return true
}
