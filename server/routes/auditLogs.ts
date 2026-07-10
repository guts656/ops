import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { createAuditLogExportTask, getAuditExportTask, getAuditLogDetail, getAuditLogOptions, queryAuditLogs } from '../data/auditLogs'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'

const querySchema = z.object({
  startTime: z.coerce.date().optional(),
  endTime: z.coerce.date().optional(),
  operator: z.string().optional(),
  actionType: z.string().optional(),
  resourceType: z.string().optional(),
  clientIp: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(10),
})

const exportSchema = z.object({
  format: z.enum(['csv', 'json']),
  filters: querySchema.omit({ page: true, pageSize: true }).optional().default({}),
})

const router = Router()

router.use(authenticate)
router.use(requirePermission(PERMISSIONS.AUDIT_LOG_VIEW))

router.get('/', async (req, res, next) => {
  try {
    res.json(await queryAuditLogs(querySchema.parse(req.query)))
  } catch (error) {
    next(error)
  }
})

router.get('/options', async (_req, res, next) => {
  try {
    res.json(await getAuditLogOptions())
  } catch (error) {
    next(error)
  }
})

router.post('/export', async (req, res, next) => {
  try {
    const values = exportSchema.parse(req.body)
    res.json({ data: await createAuditLogExportTask(values.format, values.filters) })
  } catch (error) {
    next(error)
  }
})

router.get('/export/:id/download', (req, res) => {
  const task = getAuditExportTask(req.params.id)
  if (!task) return res.status(404).json({ message: '导出任务不存在或已过期' })
  res.setHeader('Content-Type', task.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/json; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${task.fileName}"`)
  return res.send(task.content)
})

router.get('/:id', async (req, res, next) => {
  try {
    const log = await getAuditLogDetail(req.params.id)
    if (!log) return res.status(404).json({ message: '审计日志不存在' })
    return res.json({ data: log })
  } catch (error) {
    next(error)
  }
})

export default router
