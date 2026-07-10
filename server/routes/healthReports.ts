import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { generateWeeklyHealthReport, getHealthReport, getHealthReportHtml, listHealthReports } from '../data/healthReports'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'
import type { AuthRequest } from '../types/auth'

const listSchema = z.object({
  type: z.string().optional(),
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(50).optional(),
})

const generateSchema = z.object({
  weekStart: z.string().optional(),
  force: z.boolean().optional(),
})

const router = Router()
router.use(authenticate)

router.get('/', requirePermission(PERMISSIONS.AI_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await listHealthReports(listSchema.parse(req.query)) })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/preview', requirePermission(PERMISSIONS.AI_VIEW), async (req, res, next) => {
  try {
    const html = await getHealthReportHtml(req.params.id)
    if (!html) return res.status(404).json({ message: '健康报告不存在' })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(html.content)
  } catch (error) {
    next(error)
  }
})

router.get('/:id/download', requirePermission(PERMISSIONS.AI_VIEW), async (req, res, next) => {
  try {
    const html = await getHealthReportHtml(req.params.id)
    if (!html) return res.status(404).json({ message: '健康报告不存在' })
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.setHeader('Content-Disposition', `attachment; filename="${html.fileName}"`)
    res.send(html.content)
  } catch (error) {
    next(error)
  }
})

router.get('/:id', requirePermission(PERMISSIONS.AI_VIEW), async (req, res, next) => {
  try {
    const report = await getHealthReport(req.params.id)
    if (!report) return res.status(404).json({ message: '健康报告不存在' })
    res.json({ data: report })
  } catch (error) {
    next(error)
  }
})

router.post('/weekly/generate', requirePermission(PERMISSIONS.AI_VIEW), async (req: AuthRequest, res, next) => {
  try {
    const values = generateSchema.parse(req.body)
    const weekStart = values.weekStart ? new Date(values.weekStart) : undefined
    if (weekStart && Number.isNaN(weekStart.getTime())) return res.status(400).json({ message: 'weekStart 不是有效日期' })
    res.json({ data: await generateWeeklyHealthReport({ weekStart, force: values.force, generatedBy: req.user!.displayName }) })
  } catch (error) {
    next(error)
  }
})

export default router
