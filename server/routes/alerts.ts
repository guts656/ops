import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { acknowledgeAlert, createAlert, diagnoseAlert, getAlertSummary, getNoiseReductionStats, listSuppressedAlerts, queryAlerts, resolveAlert, suppressFingerprint, unsuppressFingerprint } from '../data/alerts'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'
import type { AuthRequest } from '../types/auth'

function paramId(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

const boolish = z.preprocess((value) => {
  if (value === 'true') return true
  if (value === 'false') return false
  return value
}, z.boolean().optional())

const alertFiltersSchema = z.object({
  level: z.enum(['紧急', '严重', '警告', '提示']).optional(),
  status: z.enum(['待处理', '处理中', '已解决']).optional(),
  service: z.string().optional(),
  keyword: z.string().optional(),
  source: z.string().optional(),
  includeSuppressed: boolish,
  isSuppressed: boolish,
  startTime: z.string().optional(),
  endTime: z.string().optional(),
})

const createAlertSchema = z.object({
  level: z.enum(['紧急', '严重', '警告', '提示']).optional(),
  severity: z.enum(['紧急', '严重', '警告', '提示', 'critical', 'high', 'medium', 'low', 'info']).optional(),
  service: z.string().optional(),
  title: z.string().optional(),
  content: z.string().min(1, '告警内容不能为空'),
  owner: z.string().optional(),
  source: z.string().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  relatedType: z.string().optional(),
  relatedId: z.string().optional(),
})

const suppressSchema = z.object({
  fingerprint: z.string().min(1, '告警指纹不能为空'),
  reason: z.string().min(1, '抑制原因不能为空'),
  durationMinutes: z.number().int().positive().optional(),
})

const unsuppressSchema = z.object({
  fingerprint: z.string().min(1, '告警指纹不能为空'),
})

const router = Router()

router.use(authenticate)

router.get('/', requirePermission(PERMISSIONS.ALERTS_VIEW), async (req, res, next) => {
  try {
    const filters = alertFiltersSchema.parse(req.query)
    res.json({ data: await queryAlerts(filters) })
  } catch (error) {
    next(error)
  }
})

router.post('/', requirePermission(PERMISSIONS.ALERTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const input = createAlertSchema.parse(req.body)
    res.status(201).json({ data: await createAlert(input, req.user!.displayName) })
  } catch (error) {
    next(error)
  }
})

router.get('/summary', requirePermission(PERMISSIONS.ALERTS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getAlertSummary() })
  } catch (error) {
    next(error)
  }
})

router.get('/noise/stats', requirePermission(PERMISSIONS.ALERTS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getNoiseReductionStats() })
  } catch (error) {
    next(error)
  }
})

router.get('/noise/suppressed', requirePermission(PERMISSIONS.ALERTS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await listSuppressedAlerts() })
  } catch (error) {
    next(error)
  }
})

router.post('/noise/suppress', requirePermission(PERMISSIONS.ALERTS_MANAGE), async (req, res, next) => {
  try {
    const input = suppressSchema.parse(req.body)
    res.json({ data: await suppressFingerprint(input.fingerprint, input.reason, input.durationMinutes) })
  } catch (error) {
    next(error)
  }
})

router.post('/noise/unsuppress', requirePermission(PERMISSIONS.ALERTS_MANAGE), async (req, res, next) => {
  try {
    const input = unsuppressSchema.parse(req.body)
    res.json({ data: await unsuppressFingerprint(input.fingerprint) })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/acknowledge', requirePermission(PERMISSIONS.ALERTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const updated = await acknowledgeAlert(paramId(req.params.id), req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '告警不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/resolve', requirePermission(PERMISSIONS.ALERTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const updated = await resolveAlert(paramId(req.params.id), req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '告警不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/diagnose', requirePermission(PERMISSIONS.ALERTS_VIEW), async (req: AuthRequest, res, next) => {
  try {
    const result = await diagnoseAlert(paramId(req.params.id), req.user!.displayName)
    if (!result) return res.status(404).json({ message: '告警不存在' })
    res.json({ data: result })
  } catch (error) {
    next(error)
  }
})

export default router
