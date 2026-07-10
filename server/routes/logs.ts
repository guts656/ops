import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions.ts'
import { deleteLogCollectionRule, getLogCollectionRules, saveLogCollectionRule } from '../data/logCollectionRules.ts'
import { createLogMonitorRule, deleteLogMonitorRule, evaluateLogMonitorRule, getLogMonitorRule, listLogMonitorAlerts, listLogMonitorRules, updateLogMonitorRule } from '../data/logMonitorRules.ts'
import { getLogServices, queryLogs } from '../data/logs.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { requirePermission } from '../middleware/requirePermission.ts'

const logFiltersSchema = z.object({
  keyword: z.string().optional(),
  service: z.string().optional(),
  level: z.enum(['ERROR', 'WARN', 'INFO', 'DEBUG']).optional(),
  hostId: z.string().optional(),
  source: z.string().optional(),
  startTime: z.string().datetime().optional(),
  endTime: z.string().datetime().optional(),
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
