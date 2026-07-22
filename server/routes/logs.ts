import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions.ts'
import { deleteLogCollectionRule, getLogCollectionRules, saveLogCollectionRule } from '../data/logCollectionRules.ts'
import { createLogMonitorRule, deleteLogMonitorRule, evaluateLogMonitorRule, getLogMonitorRule, listLogMonitorAlerts, listLogMonitorRules, updateLogMonitorRule } from '../data/logMonitorRules.ts'
import { getLogServices, queryLogs } from '../data/logs.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { requirePermission } from '../middleware/requirePermission.ts'
import { convertXm2MonitorJson } from '../services/xm2MonitorJsonConverter.ts'

const logFiltersSchema = z.object({
  keyword: z.string().optional(),
  service: z.string().optional(),
  level: z.enum(['ERROR', 'WARN', 'INFO', 'DEBUG']).optional(),
  hostId: z.string().optional(),
  source: z.string().optional(),
  startTime: z.string().datetime({ offset: true }).optional(),
  endTime: z.string().datetime({ offset: true }).optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(100).optional(),
})

const collectionRuleSchema = z.object({
  scope: z.enum(['host', 'group']),
  hostId: z.string().optional(),
  hostGroup: z.string().optional(),
  paths: z.array(z.string().min(1)).min(1).max(20),
  enabled: z.boolean().optional(),
})

const timeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

const hostScopeSchema = z.enum(['all', 'single', 'multiple', 'group'])

const selfHealingBindingSchema = z.object({
  enabled: z.boolean().default(false),
  actionType: z.enum(['启动服务', '重启服务']).default('重启服务'),
  targetHostId: z.string().trim().optional().or(z.literal('')),
  targetServiceId: z.string().trim().optional().or(z.literal('')),
  targetServiceName: z.string().trim().max(200).optional().or(z.literal('')),
  serviceName: z.string().trim().max(200).optional().or(z.literal('')),
  autoExecute: z.boolean().default(false),
  executionMode: z.enum(['safe', 'controlled']).default('safe'),
  retries: z.coerce.number().int().min(0).max(2).default(0),
  cooldownMinutes: z.coerce.number().int().min(1).max(1440).default(30),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']).optional(),
}).superRefine((value, ctx) => {
  if (value.enabled && !value.targetServiceName && !value.serviceName && !value.targetServiceId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['targetServiceName'], message: '启用异常自愈时必须填写目标服务' })
})

const monitorRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional(),
  enabled: z.boolean().optional(),
  service: z.string().trim().optional(),
  level: z.enum(['ERROR', 'WARN', 'INFO', 'DEBUG']).optional(),
  hostId: z.string().trim().optional(),
  hostScope: hostScopeSchema.optional(),
  hostIds: z.array(z.string().trim().min(1)).max(200).optional(),
  hostGroup: z.string().trim().optional(),
  source: z.string().trim().optional(),
  keywords: z.array(z.string().trim().min(1).max(120)).max(20).default([]),
  threshold: z.coerce.number().int().positive().max(100000),
  windowMinutes: z.coerce.number().int().positive().max(1440),
  cooldownMinutes: z.coerce.number().int().positive().max(1440).optional(),
  alertLevel: z.enum(['紧急', '严重', '警告', '提示']).optional(),
  daysOfWeek: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional(),
  timeRanges: z.array(timeRangeSchema).max(8).optional(),
  holidayMode: z.enum(['ignore', 'include', 'exclude']).optional(),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(80).optional(),
  notification: z.object({
    channels: z.array(z.enum(['站内告警', '企业微信', '钉钉'])).min(1).max(3),
    webhookUrl: z.string().url().optional().or(z.literal('')),
    receivers: z.string().max(200).optional(),
  }).optional(),
  selfHealingBinding: selfHealingBindingSchema.optional(),
}).superRefine((value, ctx) => {
  const hostIds = Array.from(new Set(value.hostIds ?? []))
  const scope = value.hostScope ?? (value.hostId ? 'single' : 'all')
  if (scope === 'single' && !value.hostId && !hostIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostId'], message: '请选择主机' })
  if (scope === 'multiple' && !hostIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostIds'], message: '请选择至少一台主机' })
  if (scope === 'group' && !value.hostGroup) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostGroup'], message: '请选择主机组' })
  if (!value.keywords.length && !value.level && !value.service && !value.source && scope === 'all') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['keywords'], message: '请至少填写关键字或选择日志级别/服务/来源/主机范围' })
  }
})

function normalizeMonitorRuleInput(input: z.infer<typeof monitorRuleSchema>) {
  const hostIds = Array.from(new Set((input.hostIds ?? []).filter(Boolean)))
  const hostScope = input.hostScope ?? (input.hostId ? 'single' : 'all')
  if (hostScope === 'all') return { ...input, hostScope, hostId: undefined, hostIds: [], hostGroup: undefined }
  if (hostScope === 'single') {
    const hostId = input.hostId || hostIds[0]
    return { ...input, hostScope, hostId, hostIds: hostId ? [hostId] : [], hostGroup: undefined }
  }
  if (hostScope === 'multiple') return { ...input, hostScope, hostId: undefined, hostIds, hostGroup: undefined }
  return { ...input, hostScope, hostId: undefined, hostIds: [], hostGroup: input.hostGroup }
}

const xm2PreviewSchema = z.object({
  rawJson: z.string().max(8 * 1024 * 1024).optional(),
  content: z.unknown().optional(),
}).superRefine((value, ctx) => {
  if (!value.rawJson && value.content === undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['rawJson'], message: '请上传或粘贴 xm2 monitor.json 内容' })
})

const xm2ImportSchema = z.object({
  rules: z.array(monitorRuleSchema).min(1).max(200),
  enabled: z.boolean().default(false),
  hostScope: hostScopeSchema.default('all'),
  hostId: z.string().trim().optional(),
  hostIds: z.array(z.string().trim().min(1)).max(200).optional(),
  hostGroup: z.string().trim().optional(),
  daysOfWeek: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional(),
  holidayMode: z.enum(['ignore', 'include', 'exclude']).optional(),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(80).optional(),
})

function xm2Input(value: z.infer<typeof xm2PreviewSchema>) {
  if (value.rawJson) {
    try {
      return JSON.parse(value.rawJson)
    } catch {
      throw new Error('xm2 monitor.json 不是有效 JSON')
    }
  }
  return value.content
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : '导入失败'
}

const router = Router()

router.use(authenticate)

router.get('/', requirePermission(PERMISSIONS.LOGS_VIEW), async (req, res, next) => {
  try {
    const filters = logFiltersSchema.parse(req.query)
    res.json(await queryLogs(filters))
  } catch (error) {
    next(error)
  }
})

router.get('/services', requirePermission(PERMISSIONS.LOGS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getLogServices() })
  } catch (error) {
    next(error)
  }
})

router.get('/collection-rules', requirePermission(PERMISSIONS.LOGS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getLogCollectionRules() })
  } catch (error) {
    next(error)
  }
})

router.post('/collection-rules', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await saveLogCollectionRule(collectionRuleSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.delete('/collection-rules/:id', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req, res, next) => {
  try {
    await deleteLogCollectionRule(req.params.id)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.get('/monitor-rules', requirePermission(PERMISSIONS.LOGS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await listLogMonitorRules() })
  } catch (error) {
    next(error)
  }
})

router.post('/xm2-convert/preview', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    const input = xm2Input(xm2PreviewSchema.parse(req.body))
    const result = convertXm2MonitorJson(input)
    const candidates = []
    const skipped = [...result.skipped]

    for (const candidate of result.candidates) {
      const parsed = monitorRuleSchema.safeParse(candidate.rule)
      if (parsed.success) candidates.push({ ...candidate, rule: parsed.data })
      else skipped.push({
        legacyIndex: candidate.legacyIndex,
        legacyKey: candidate.legacyKey,
        legacyName: candidate.legacyName,
        type: 'fileContent',
        mode: 'include',
        source: candidate.sourceFile,
        word: candidate.rule.keywords[0],
        reason: parsed.error.issues.map((issue) => issue.message).join('；') || '转换后规则校验失败',
      })
    }

    res.json({ data: { summary: { total: result.summary.total, convertible: candidates.length, skipped: skipped.length, invalid: skipped.length - result.skipped.length }, candidates, skipped } })
  } catch (error) {
    next(error)
  }
})

router.post('/xm2-convert/import', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    const input = xm2ImportSchema.parse(req.body)
    const imported = []
    const failed = []
    const hostIds = Array.from(new Set((input.hostIds ?? []).filter(Boolean)))

    for (const [index, rule] of input.rules.entries()) {
      try {
        const payload = normalizeMonitorRuleInput(monitorRuleSchema.parse({
          ...rule,
          enabled: input.enabled,
          hostScope: input.hostScope,
          hostId: input.hostScope === 'single' ? input.hostId || hostIds[0] : undefined,
          hostIds: input.hostScope === 'multiple' ? hostIds : input.hostScope === 'single' && (input.hostId || hostIds[0]) ? [input.hostId || hostIds[0]] : [],
          hostGroup: input.hostScope === 'group' ? input.hostGroup : undefined,
          daysOfWeek: input.daysOfWeek ?? [],
          holidayMode: input.holidayMode ?? 'ignore',
          holidays: input.holidays ?? [],
        }))
        imported.push(await createLogMonitorRule(payload))
      } catch (error) {
        failed.push({ index, name: rule.name, reason: errorMessage(error) })
      }
    }

    res.json({ data: { imported, failed } })
  } catch (error) {
    next(error)
  }
})

router.post('/monitor-rules', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await createLogMonitorRule(normalizeMonitorRuleInput(monitorRuleSchema.parse(req.body))) })
  } catch (error) {
    next(error)
  }
})

router.put('/monitor-rules/:id', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateLogMonitorRule(req.params.id, normalizeMonitorRuleInput(monitorRuleSchema.parse(req.body))) })
  } catch (error) {
    next(error)
  }
})

router.delete('/monitor-rules/:id', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    await deleteLogMonitorRule(req.params.id)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.post('/monitor-rules/:id/evaluate', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    const rule = await getLogMonitorRule(req.params.id)
    if (!rule) return res.status(404).json({ message: '日志监控规则不存在' })
    res.json({ data: await evaluateLogMonitorRule(rule) })
  } catch (error) {
    next(error)
  }
})

router.get('/monitor-alerts', requirePermission(PERMISSIONS.LOGS_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await listLogMonitorAlerts(typeof req.query.ruleId === 'string' ? req.query.ruleId : undefined) })
  } catch (error) {
    next(error)
  }
})

export default router
