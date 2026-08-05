import { Router, type NextFunction, type Response } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { copySelfHealingRule, createSelfHealingRule, deleteSelfHealingRule, querySelfHealingHistory, querySelfHealingRules, setSelfHealingRuleEnabled, updateSelfHealingRule } from '../data/selfHealing'
import { runSelfHealingEvaluatorForRule } from '../services/selfHealingEvaluator'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'
import type { AuthRequest } from '../types/auth'

function paramId(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

const conditionSchema = z.object({
  dataSource: z.enum(['指标', '事件', '日志']),
  metric: z.string().min(1),
  service: z.string().min(1),
  operator: z.enum(['>', '>=', '<', '<=', '==']),
  threshold: z.coerce.number(),
  windowValue: z.coerce.number().positive(),
  windowUnit: z.enum(['秒', '分钟']),
  intervalValue: z.coerce.number().positive(),
  intervalUnit: z.enum(['秒', '分钟']),
})

const actionSchema = z.object({
  type: z.enum(['启动服务', '重启服务', '扩缩容', '执行脚本', '发通知']),
  target: z.string().min(1),
  retries: z.coerce.number().min(0).optional(),
  cooldown: z.coerce.number().min(0).optional(),
})

const notificationSchema = z.object({
  receivers: z.string().default(''),
  template: z.string().default(''),
}).transform((value) => ({ ...value, channels: [] }))

const ruleSchema = z.object({
  name: z.string().min(1),
  description: z.string().default(''),
  priority: z.enum(['P0', 'P1', 'P2', 'P3']),
  enabled: z.boolean().default(true),
  autoExecute: z.boolean().default(false),
  executionMode: z.enum(['safe', 'controlled']).default('safe'),
  logic: z.enum(['AND', 'OR']),
  conditions: z.array(conditionSchema).min(1),
  actions: z.array(actionSchema).min(1),
  notification: notificationSchema,
})

const historyFiltersSchema = z.object({
  ruleId: z.string().optional(),
})

const enabledSchema = z.object({ enabled: z.boolean() })
const router = Router()

router.use(authenticate)

router.get('/rules', requirePermission(PERMISSIONS.SELF_HEALING_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await querySelfHealingRules() })
  } catch (error) {
    next(error)
  }
})

router.get('/history', requirePermission(PERMISSIONS.SELF_HEALING_VIEW), async (req, res, next) => {
  try {
    const filters = historyFiltersSchema.parse(req.query)
    res.json({ data: await querySelfHealingHistory(filters) })
  } catch (error) {
    next(error)
  }
})

router.post('/rules', requirePermission(PERMISSIONS.SELF_HEALING_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const values = ruleSchema.parse(req.body)
    res.json({ data: await createSelfHealingRule(values, req.user!.displayName) })
  } catch (error) {
    next(error)
  }
})

async function updateRule(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const values = ruleSchema.parse(req.body)
    const updated = await updateSelfHealingRule(paramId(req.params.id), values, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '自愈规则不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
}

router.put('/rules/:id', requirePermission(PERMISSIONS.SELF_HEALING_MANAGE), updateRule)
router.patch('/rules/:id', requirePermission(PERMISSIONS.SELF_HEALING_MANAGE), updateRule)

router.patch('/rules/:id/enabled', requirePermission(PERMISSIONS.SELF_HEALING_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const values = enabledSchema.parse(req.body)
    const updated = await setSelfHealingRuleEnabled(paramId(req.params.id), values.enabled, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '自愈规则不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/rules/:id/copy', requirePermission(PERMISSIONS.SELF_HEALING_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const copied = await copySelfHealingRule(paramId(req.params.id), req.user!.displayName)
    if (!copied) return res.status(404).json({ message: '自愈规则不存在' })
    res.json({ data: copied })
  } catch (error) {
    next(error)
  }
})

router.post('/rules/:id/evaluate', requirePermission(PERMISSIONS.SELF_HEALING_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const execution = await runSelfHealingEvaluatorForRule(paramId(req.params.id))
    res.json({ success: true, data: execution })
  } catch (error) {
    next(error)
  }
})

router.delete('/rules/:id', requirePermission(PERMISSIONS.SELF_HEALING_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const deleted = await deleteSelfHealingRule(paramId(req.params.id), req.user!.displayName)
    if (!deleted) return res.status(404).json({ message: '自愈规则不存在' })
    res.json({ success: true, id: deleted.id })
  } catch (error) {
    next(error)
  }
})

export default router
