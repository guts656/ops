import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { createCgiMonitorRule, deleteCgiMonitorRule, evaluateCgiMonitorRule, getCgiMonitorRule, listCgiMonitorAlerts, listCgiMonitorRules, updateCgiMonitorRule } from '../data/cgiMonitorRules'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'

const timeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

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
  if (value.enabled && !value.targetServiceName && !value.serviceName && !value.targetServiceId) ctx.addIssue({ code: 'custom', path: ['targetServiceName'], message: '启用异常自愈时必须填写目标服务' })
})

const cgiMonitorRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional(),
  enabled: z.boolean().optional(),
  url: z.string().trim().url().max(1000),
  probeHostId: z.string().trim().min(1).optional().nullable().or(z.literal('')),
  method: z.enum(['GET', 'POST', 'HEAD']).optional(),
  keyword: z.string().trim().min(1).max(200),
  matchMode: z.enum(['contains', 'not_contains']).optional(),
  expectedStatus: z.coerce.number().int().min(100).max(599).nullish(),
  timeoutMs: z.coerce.number().int().min(1000).max(60000).optional(),
  intervalSeconds: z.coerce.number().int().min(10).max(86400).optional(),
  failureThreshold: z.coerce.number().int().min(1).max(100).optional(),
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
})

const router = Router()
router.use(authenticate)

router.get('/rules', requirePermission(PERMISSIONS.LOGS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await listCgiMonitorRules() })
  } catch (error) {
    next(error)
  }
})

router.post('/rules', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await createCgiMonitorRule(cgiMonitorRuleSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.put('/rules/:id', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateCgiMonitorRule(req.params.id, cgiMonitorRuleSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.delete('/rules/:id', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    await deleteCgiMonitorRule(req.params.id)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.post('/rules/:id/evaluate', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    const rule = await getCgiMonitorRule(req.params.id)
    if (!rule) return res.status(404).json({ message: 'CGI/URL 监控规则不存在' })
    res.json({ data: await evaluateCgiMonitorRule(rule, new Date(), { force: true }) })
  } catch (error) {
    next(error)
  }
})

router.get('/alerts', requirePermission(PERMISSIONS.LOGS_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await listCgiMonitorAlerts(typeof req.query.ruleId === 'string' ? req.query.ruleId : undefined) })
  } catch (error) {
    next(error)
  }
})

export default router
