import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { createAlertHandlingRule, deleteAlertHandlingRule, listAlertHandlingRules, updateAlertHandlingRule } from '../data/alertHandlingRules'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'

const ruleSchema = z.object({
  name: z.string().min(1, '规则名称不能为空'),
  description: z.string().optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().optional(),
  alertSource: z.string().optional(),
  alertLevel: z.enum(['紧急', '严重', '警告', '提示']).optional(),
  titlePattern: z.string().optional(),
  servicePattern: z.string().optional(),
  matchers: z.record(z.string(), z.unknown()).optional(),
  selfHealingRuleId: z.string().min(1, '请选择自愈规则'),
  cooldownMinutes: z.number().int().min(0).optional(),
  autoExecute: z.boolean().optional(),
})

const router = Router()

router.use(authenticate)

router.get('/', requirePermission(PERMISSIONS.ALERT_HANDLING_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await listAlertHandlingRules() })
  } catch (error) {
    next(error)
  }
})

router.post('/', requirePermission(PERMISSIONS.ALERT_HANDLING_MANAGE), async (req, res, next) => {
  try {
    res.status(201).json({ data: await createAlertHandlingRule(ruleSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.put('/:id', requirePermission(PERMISSIONS.ALERT_HANDLING_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateAlertHandlingRule(req.params.id, ruleSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', requirePermission(PERMISSIONS.ALERT_HANDLING_MANAGE), async (req, res, next) => {
  try {
    await deleteAlertHandlingRule(req.params.id)
    res.json({ success: true, id: req.params.id })
  } catch (error) {
    next(error)
  }
})

export default router
