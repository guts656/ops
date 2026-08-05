import { Router } from 'express'
import { z } from 'zod'
import { createIpushMonitorRule, deleteIpushMonitorRule, evaluateIpushMonitorRule, getIpushMonitorRule, listIpushMonitorAlerts, listIpushMonitorRules, updateIpushMonitorRule } from '../data/ipushMonitorRules'
import { PERMISSIONS } from '../config/permissions'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'

const timeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})

const tokenSchema = z.string().trim().min(1).max(120).refine((value) => !/\s|[\u0000-\u001f\u007f]/.test(value), '不能包含空格、换行或控制字符')

const ipushMonitorRuleSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(300).optional(),
  enabled: z.boolean().optional(),
  hostId: z.string().trim().min(1).optional().nullable().or(z.literal('')),
  targetHost: z.string().trim().min(1).max(253).regex(/^[a-zA-Z0-9_.:-]+$/),
  port: z.coerce.number().int().min(1).max(65535),
  systemCode: tokenSchema,
  serviceCode: tokenSchema,
  username: tokenSchema,
  password: tokenSchema.optional().or(z.literal('')),
  expectedGreeting: z.string().trim().min(1).max(120).optional(),
  expectedLoginResult: z.string().trim().min(1).max(200).optional(),
  connectTimeoutMs: z.coerce.number().int().min(500).max(60000).optional(),
  responseTimeoutMs: z.coerce.number().int().min(500).max(60000).optional(),
  intervalSeconds: z.coerce.number().int().min(10).max(86400).optional(),
  failureThreshold: z.coerce.number().int().min(1).max(100).optional(),
  cooldownMinutes: z.coerce.number().int().min(1).max(1440).optional(),
  alertLevel: z.enum(['紧急', '严重', '警告', '提示']).optional(),
  daysOfWeek: z.array(z.coerce.number().int().min(1).max(7)).max(7).optional(),
  timeRanges: z.array(timeRangeSchema).max(8).optional(),
  holidayMode: z.enum(['ignore', 'include', 'exclude']).optional(),
  holidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)).max(80).optional(),
  notification: z.object({ receivers: z.string().max(200).optional() }).optional(),
})

const router = Router()
router.use(authenticate)

function paramId(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

router.get('/rules', requirePermission(PERMISSIONS.LOGS_VIEW), async (_req, res, next) => {
  try { res.json({ data: await listIpushMonitorRules() }) } catch (error) { next(error) }
})

router.post('/rules', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try { res.json({ data: await createIpushMonitorRule(ipushMonitorRuleSchema.parse(req.body)) }) } catch (error) { next(error) }
})

router.put('/rules/:id', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    const rule = await updateIpushMonitorRule(paramId(req.params.id), ipushMonitorRuleSchema.parse(req.body))
    if (!rule) return res.status(404).json({ message: 'iPush监控规则不存在' })
    res.json({ data: rule })
  } catch (error) { next(error) }
})

router.delete('/rules/:id', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try { await deleteIpushMonitorRule(paramId(req.params.id)); res.json({ success: true }) } catch (error) { next(error) }
})

router.post('/rules/:id/evaluate', requirePermission(PERMISSIONS.LOGS_MANAGE), async (req, res, next) => {
  try {
    const rule = await getIpushMonitorRule(paramId(req.params.id))
    if (!rule) return res.status(404).json({ message: 'iPush监控规则不存在' })
    res.json({ data: await evaluateIpushMonitorRule(rule, new Date(), { force: true }) })
  } catch (error) { next(error) }
})

router.get('/alerts', requirePermission(PERMISSIONS.LOGS_VIEW), async (req, res, next) => {
  try { res.json({ data: await listIpushMonitorAlerts(typeof req.query.ruleId === 'string' ? req.query.ruleId : undefined) }) } catch (error) { next(error) }
})

export default router
