import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { createHostResourceMonitorRule, deleteHostResourceMonitorRule, evaluateHostResourceMonitorRule, getHostResourceMonitorRule, listHostResourceMonitorAlerts, listHostResourceMonitorRules, updateHostResourceMonitorRule } from '../data/hostResourceMonitorRules'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'

const timeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

const hostScopeSchema = z.enum(['all', 'single', 'multiple', 'group'])

const ruleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional(),
  enabled: z.boolean().optional(),
  hostId: z.string().trim().optional(),
  hostScope: hostScopeSchema.optional(),
  hostIds: z.array(z.string().trim().min(1)).max(200).optional(),
  hostGroup: z.string().trim().optional(),
  metrics: z.array(z.enum(['cpu', 'memory', 'disk'])).min(1).max(3).optional(),
  threshold: z.coerce.number().int().min(1).max(100).optional(),
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
}).superRefine((value, ctx) => {
  const hostIds = Array.from(new Set(value.hostIds ?? []))
  const scope = value.hostScope ?? (value.hostId ? 'single' : 'all')
  if (scope === 'single' && !value.hostId && !hostIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostId'], message: '请选择主机' })
  if (scope === 'multiple' && !hostIds.length) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostIds'], message: '请选择至少一台主机' })
  if (scope === 'group' && !value.hostGroup) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['hostGroup'], message: '请选择主机组' })
})

function normalizeInput(input: z.infer<typeof ruleSchema>) {
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

router.get('/rules', requirePermission(PERMISSIONS.LOGS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await listHostResourceMonitorRules() })
  } catch (error) {
    next(error)
  }
})

router.post('/rules', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await createHostResourceMonitorRule(normalizeInput(ruleSchema.parse(req.body))) })
  } catch (error) {
    next(error)
  }
})

router.put('/rules/:id', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateHostResourceMonitorRule(req.params.id, normalizeInput(ruleSchema.parse(req.body))) })
  } catch (error) {
    next(error)
  }
})

router.delete('/rules/:id', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    await deleteHostResourceMonitorRule(req.params.id)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.post('/rules/:id/evaluate', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    const rule = await getHostResourceMonitorRule(req.params.id)
    if (!rule) return res.status(404).json({ message: '主机资源监控规则不存在' })
    res.json({ data: await evaluateHostResourceMonitorRule(rule) })
  } catch (error) {
    next(error)
  }
})

router.get('/alerts', requirePermission(PERMISSIONS.LOGS_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await listHostResourceMonitorAlerts(typeof req.query.ruleId === 'string' ? req.query.ruleId : undefined) })
  } catch (error) {
    next(error)
  }
})

export default router
