import { prisma } from '../db/prisma'
import { getSelfHealingExecutionSuppression, recordSelfHealingExecutionFromEvaluator } from '../data/selfHealing'
import { loadProbeHostConnection } from '../data/hostConnections'
import { executeHostServiceControl, type ServiceControlAction } from './hostServiceControl'
import type { SelfHealingAction, SelfHealingActionResult, SelfHealingCondition, SelfHealingRule } from '../../src/types/selfHealing'

interface ConditionResult {
  matched: boolean
  value: number
  samples: number
  target: string
  metric: string
  windowMs: number
  evidence: string
  hostIds: string[]
}

interface HostTarget {
  id: string
  hostname: string
  ip: string
  cpu: number
  memory: number
  disk: number
}

interface ActionExecutionContext {
  service: string
  triggerValue: string
  evidenceLogs: string[]
  candidateHostIds?: string[]
  duration?: string
  alertId?: string
}

const metricAliases: Record<string, keyof Pick<HostTarget, 'cpu' | 'memory' | 'disk'>> = {
  cpu: 'cpu',
  cpu_usage: 'cpu',
  memory: 'memory',
  memory_usage: 'memory',
  disk: 'disk',
  disk_usage: 'disk',
}

let started = false
let running = false

function windowMs(condition: SelfHealingCondition) {
  const value = Math.max(1, Number(condition.windowValue) || 1)
  return value * (condition.windowUnit === '分钟' ? 60_000 : 1000)
}

function compare(value: number, operator: SelfHealingCondition['operator'], threshold: number) {
  switch (operator) {
    case '>': return value > threshold
    case '>=': return value >= threshold
    case '<': return value < threshold
    case '<=': return value <= threshold
    case '==': return value === threshold
    default: return false
  }
}

function normalize(value: string) {
  return value.trim().toLowerCase()
}

function displayWindow(condition: SelfHealingCondition) {
  return `${condition.windowValue}${condition.windowUnit}`
}

function aggregate(values: number[]) {
  if (!values.length) return 0
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)))
}

function controlledExecutionEnabled(rule: SelfHealingRule) {
  return Boolean(rule.autoExecute && rule.executionMode === 'controlled')
}

function actionToControl(action: SelfHealingAction): ServiceControlAction | undefined {
  if (action.type === '启动服务') return 'start'
  if (action.type === '重启服务') return 'restart'
  return undefined
}

async function metricTargets(service: string): Promise<HostTarget[]> {
  const keyword = normalize(service)
  const hosts = await prisma.host.findMany({
    where: {
      OR: [
        { id: service },
        { hostname: { equals: service, mode: 'insensitive' } },
        { ip: service },
        { services: { some: { name: { equals: service, mode: 'insensitive' } } } },
      ],
    },
    select: { id: true, hostname: true, ip: true, cpu: true, memory: true, disk: true },
  })
  if (hosts.length) return hosts
  return prisma.host.findMany({
    where: {
      OR: [
        { hostname: { contains: keyword, mode: 'insensitive' } },
        { ip: { contains: keyword } },
        { services: { some: { name: { contains: keyword, mode: 'insensitive' } } } },
      ],
    },
    select: { id: true, hostname: true, ip: true, cpu: true, memory: true, disk: true },
  })
}

async function evaluateMetric(condition: SelfHealingCondition): Promise<ConditionResult> {
  const metric = metricAliases[normalize(condition.metric)]
  const ms = windowMs(condition)
  if (!metric) {
    return { matched: false, value: 0, samples: 0, target: condition.service, metric: condition.metric, windowMs: ms, evidence: `指标 ${condition.metric} 不支持`, hostIds: [] }
  }

  const hosts = await metricTargets(condition.service)
  if (!hosts.length) {
    return { matched: false, value: 0, samples: 0, target: condition.service, metric: condition.metric, windowMs: ms, evidence: `未找到匹配主机或服务：${condition.service}`, hostIds: [] }
  }

  const since = new Date(Date.now() - ms)
  const points = await prisma.hostResourcePoint.findMany({
    where: { hostId: { in: hosts.map((host) => host.id) }, sampledAt: { gte: since } },
    select: { hostId: true, cpu: true, memory: true, disk: true },
  })
  const values = points.length ? points.map((point) => point[metric]) : hosts.map((host) => host[metric])
  const value = aggregate(values)
  const target = hosts.map((host) => host.hostname || host.ip).join(', ')
  return {
    matched: compare(value, condition.operator, condition.threshold),
    value,
    samples: values.length,
    target,
    metric: condition.metric,
    windowMs: ms,
    evidence: `指标 ${condition.metric} 在 ${displayWindow(condition)} 内观测值 ${value}，样本 ${values.length}，目标 ${target}`,
    hostIds: unique(points.length ? points.map((point) => point.hostId) : hosts.map((host) => host.id)),
  }
}

async function evaluateLogs(condition: SelfHealingCondition): Promise<ConditionResult> {
  const ms = windowMs(condition)
  const since = new Date(Date.now() - ms)
  const metric = normalize(condition.metric)
  const where = {
    service: { equals: condition.service, mode: 'insensitive' as const },
    timestamp: { gte: since },
    ...(metric === 'log_count' ? {} : { level: { equals: condition.metric, mode: 'insensitive' as const } }),
  }
  const [value, hosts] = await Promise.all([
    prisma.appLog.count({ where }),
    prisma.appLog.findMany({ where: { ...where, hostId: { not: null } }, select: { hostId: true }, distinct: ['hostId'] }),
  ])
  return {
    matched: compare(value, condition.operator, condition.threshold),
    value,
    samples: value,
    target: condition.service,
    metric: condition.metric,
    windowMs: ms,
    evidence: `日志 ${condition.metric} 在 ${displayWindow(condition)} 内匹配 ${value} 条，服务 ${condition.service}`,
    hostIds: unique(hosts.map((host) => host.hostId ?? '')),
  }
}

async function evaluateEvents(condition: SelfHealingCondition): Promise<ConditionResult> {
  const ms = windowMs(condition)
  const since = new Date(Date.now() - ms)
  const metric = normalize(condition.metric)
  const where = {
    service: { equals: condition.service, mode: 'insensitive' as const },
    occurredAt: { gte: since },
    ...(metric === 'event_count' ? {} : {
      OR: [
        { level: { equals: condition.metric, mode: 'insensitive' as const } },
        { eventType: { equals: condition.metric, mode: 'insensitive' as const } },
      ],
    }),
  }
  const [value, hosts] = await Promise.all([
    prisma.serviceEvent.count({ where }),
    prisma.serviceEvent.findMany({ where, select: { hostId: true }, distinct: ['hostId'] }),
  ])
  return {
    matched: compare(value, condition.operator, condition.threshold),
    value,
    samples: value,
    target: condition.service,
    metric: condition.metric,
    windowMs: ms,
    evidence: `事件 ${condition.metric} 在 ${displayWindow(condition)} 内匹配 ${value} 条，服务 ${condition.service}`,
    hostIds: unique(hosts.map((host) => host.hostId)),
  }
}

async function evaluateCondition(condition: SelfHealingCondition) {
  if (condition.dataSource === '指标') return evaluateMetric(condition)
  if (condition.dataSource === '日志') return evaluateLogs(condition)
  return evaluateEvents(condition)
}

function triggerValue(rule: SelfHealingRule, results: ConditionResult[]) {
  const matched = results.filter((result) => result.matched)
  const summary = matched.length ? matched : results
  return `${rule.logic} 命中 ${matched.length}/${results.length}：${summary.map((result) => `${result.metric}=${result.value}`).join('，')}`
}

function matchedHostIds(results: ConditionResult[]) {
  const matched = results.filter((result) => result.matched)
  return unique((matched.length ? matched : results).flatMap((result) => result.hostIds))
}

function isHostInMaintenance(host: { maintenanceEnabled: boolean; maintenanceUntil: Date | null }) {
  return Boolean(host.maintenanceEnabled && (!host.maintenanceUntil || host.maintenanceUntil > new Date()))
}

async function resolveServiceTarget(action: SelfHealingAction, candidateHostIds: string[] = []) {
  const target = action.target.trim()
  const targetHostId = action.targetHostId?.trim()
  const targetServiceId = action.targetServiceId?.trim()
  const targetServiceName = action.targetServiceName?.trim()
  const scopedHostIds = unique([targetHostId ?? '', ...candidateHostIds])

  if (targetServiceId) {
    const service = await prisma.hostService.findUnique({ where: { id: targetServiceId }, include: { host: true } })
    if (!service) throw new Error(`未找到服务目标：${targetServiceId}`)
    if (targetHostId && service.hostId !== targetHostId) throw new Error(`服务目标 ${service.name} 不属于指定目标主机`)
    return service
  }

  const lookupName = targetServiceName || target
  if (targetServiceName && !scopedHostIds.length) throw new Error('请选择自愈目标主机，受控执行不会按全局服务名匹配')

  const services = await prisma.hostService.findMany({
    where: {
      OR: [
        { id: lookupName },
        { name: { equals: lookupName, mode: 'insensitive' as const } },
      ],
      ...(scopedHostIds.length ? { hostId: { in: scopedHostIds } } : {}),
    },
    include: { host: true },
  })
  if (!services.length) throw new Error(`未在指定目标主机上找到服务：${lookupName}`)
  if (services.length > 1) {
    const labels = services.map((service) => `${service.host.hostname}/${service.name}`).join('，')
    throw new Error(`服务目标不唯一：${lookupName} 匹配 ${services.length} 个服务（${labels}）`)
  }
  return services[0]
}

async function executeActionWithRetries(rule: SelfHealingRule, action: SelfHealingAction, candidateHostIds: string[]) {
  const controlAction = actionToControl(action)
  if (!controlAction) {
    return {
      action: action.type,
      target: action.target,
      status: '跳过',
      summary: '当前受控执行阶段只允许启动服务和重启服务；该动作仅记录计划。',
      attempts: 0,
    } satisfies SelfHealingActionResult
  }

  let service: Awaited<ReturnType<typeof resolveServiceTarget>>
  try {
    service = await resolveServiceTarget(action, candidateHostIds)
    if (isHostInMaintenance(service.host)) throw new Error(`主机 ${service.host.hostname} 正在维护中，跳过受控执行`)
  } catch (error) {
    return {
      action: action.type,
      target: action.target,
      status: '失败',
      summary: error instanceof Error ? error.message : '服务目标解析失败',
      attempts: 0,
    } satisfies SelfHealingActionResult
  }

  const maxRetries = Math.min(2, Math.max(0, Number(action.retries) || 0))
  let lastError = ''
  let jobId: string | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const { connection } = await loadProbeHostConnection(service.hostId, 120_000)
      const result = await executeHostServiceControl({
        host: service.host,
        service,
        connection,
        operator: 'system:self-healing',
        action: controlAction,
        source: 'self-healing',
      })
      jobId = result.jobId
      if (result.success) {
        return {
          action: action.type,
          target: action.target,
          status: '成功',
          summary: result.summary,
          hostId: result.hostId,
          serviceId: result.serviceId,
          serviceName: result.serviceName,
          agentJobId: result.jobId,
          attempts: attempt + 1,
        } satisfies SelfHealingActionResult
      }
      lastError = result.summary
    } catch (error) {
      lastError = error instanceof Error ? error.message : '服务控制执行异常'
    }
  }

  return {
    action: action.type,
    target: action.target,
    status: '失败',
    summary: lastError || '服务控制执行失败',
    hostId: service.hostId,
    serviceId: service.id,
    serviceName: service.name,
    agentJobId: jobId,
    attempts: maxRetries + 1,
  } satisfies SelfHealingActionResult
}

export async function recordSelfHealingMatch(rule: SelfHealingRule, context: ActionExecutionContext) {
  if (!controlledExecutionEnabled(rule)) {
    const logs = [
      '安全模式：未执行任何 SSH、WinRM、脚本、扩缩容或 Agent Job 命令，仅记录计划动作。',
      ...context.evidenceLogs,
      ...rule.actions.map((action) => `计划动作：${action.type} -> ${action.target}，冷却 ${action.cooldown ?? 0} 分钟，重试 ${action.retries ?? 0} 次`),
    ]
    return recordSelfHealingExecutionFromEvaluator(rule, context.service, '成功', context.triggerValue, logs, context.duration ?? '0ms', context.alertId)
  }

  const suppression = await getSelfHealingExecutionSuppression(rule, context.service, '成功', context.triggerValue)
  if (suppression) return undefined

  const logs = [
    '受控执行模式：仅允许启动服务/重启服务；脚本、扩缩容和任意命令仍不会执行。',
    '受控执行使用主机已保存且启用的 Pull 凭据，不记录密码或私钥。',
    ...context.evidenceLogs,
  ]
  const actionResults: SelfHealingActionResult[] = []
  for (const action of rule.actions) {
    const result = await executeActionWithRetries(rule, action, context.candidateHostIds ?? [])
    actionResults.push(result)
    logs.push(`${result.status}：${action.type} -> ${action.target}；${result.summary}${result.agentJobId ? `；Agent Job ${result.agentJobId}` : ''}`)
  }

  const hasFailure = actionResults.some((result) => result.status === '失败')
  const agentJobIds = unique(actionResults.map((result) => result.agentJobId ?? ''))
  return recordSelfHealingExecutionFromEvaluator(rule, context.service, hasFailure ? '失败' : '成功', context.triggerValue, logs, context.duration ?? '0ms', context.alertId, {
    mode: 'controlled',
    actionResults,
    agentJobIds,
    auditDetail: hasFailure ? `受控执行失败，Agent Job：${agentJobIds.join(', ') || '无'}` : `受控执行完成，Agent Job：${agentJobIds.join(', ') || '无'}`,
  })
}

async function evaluateRule(rule: SelfHealingRule) {
  const startedAt = Date.now()
  try {
    const results = []
    for (const condition of rule.conditions) {
      results.push(await evaluateCondition(condition))
    }
    const matched = rule.logic === 'OR' ? results.some((result) => result.matched) : results.every((result) => result.matched)
    if (!matched) return undefined

    const service = results.find((result) => result.matched)?.target || rule.conditions[0]?.service || '-'
    return recordSelfHealingMatch(rule, {
      service,
      triggerValue: triggerValue(rule, results),
      evidenceLogs: results.map((result) => `${result.matched ? '命中' : '未命中'}：${result.evidence}`),
      candidateHostIds: matchedHostIds(results),
      duration: `${Date.now() - startedAt}ms`,
    })
  } catch (error) {
    return recordSelfHealingExecutionFromEvaluator(rule, rule.conditions[0]?.service || '-', '失败', '规则评估异常', [error instanceof Error ? error.message : String(error)], `${Date.now() - startedAt}ms`)
  }
}

function toSelfHealingRule(rule: NonNullable<Awaited<ReturnType<typeof prisma.selfHealingRule.findFirst>>>): SelfHealingRule {
  return {
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
    conditionText: '',
  }
}

export async function runSelfHealingEvaluatorForRule(ruleId: string) {
  const rule = await prisma.selfHealingRule.findUnique({ where: { id: ruleId } })
  if (!rule || !rule.enabled) return
  return evaluateRule(toSelfHealingRule(rule))
}

export async function runSelfHealingEvaluatorOnce() {
  const rules = await prisma.selfHealingRule.findMany({ where: { enabled: true }, orderBy: { priority: 'asc' } })
  for (const rule of rules) {
    await evaluateRule(toSelfHealingRule(rule))
  }
}

export function startSelfHealingEvaluator() {
  if (started) return
  started = true
  const intervalMs = Math.max(5000, Number(process.env.SELF_HEALING_EVALUATOR_INTERVAL_MS || 30000))

  async function tick() {
    if (running) return
    running = true
    try {
      await runSelfHealingEvaluatorOnce()
    } catch (error) {
      console.error('自愈规则评估调度失败', error)
    } finally {
      running = false
    }
  }

  setInterval(() => void tick(), intervalMs)
  void tick()
}
