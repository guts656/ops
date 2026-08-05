import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { checkSslCertificateMonitorNow, createSslCertificateMonitor, deleteSslCertificateMonitor, getSslCertificateMonitor, listSslCertificateHistories, listSslCertificateMonitors, updateSslCertificateMonitor } from '../data/sslCertificateMonitors'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'
import { isValidSslDomain } from '../services/sslCertificateChecker'

const notificationSchema = z.object({
  receivers: z.string().max(200).optional(),
}).optional()

const monitorSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().max(300).optional(),
  enabled: z.boolean().optional(),
  domain: z.string().trim().min(1).refine(isValidSslDomain, '请输入合法域名，不包含协议、路径、端口或本机地址'),
  serverIp: z.string().trim().max(100).optional().or(z.literal('')),
  port: z.coerce.number().int().min(1).max(65535).optional(),
  thresholds: z.array(z.coerce.number().int().min(1).max(365)).min(1).max(12).optional(),
  checkTime: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  alertLevel: z.enum(['紧急', '严重', '警告', '提示']).optional(),
  notification: notificationSchema,
})

const router = Router()
router.use(authenticate)

router.get('/monitors', requirePermission(PERMISSIONS.SSL_CERTIFICATES_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await listSslCertificateMonitors() })
  } catch (error) {
    next(error)
  }
})

router.post('/monitors', requirePermission(PERMISSIONS.SSL_CERTIFICATES_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await createSslCertificateMonitor(monitorSchema.parse(req.body), req.user!.displayName) })
  } catch (error) {
    next(error)
  }
})

router.put('/monitors/:id', requirePermission(PERMISSIONS.SSL_CERTIFICATES_MANAGE), async (req, res, next) => {
  try {
    const monitor = await getSslCertificateMonitor(req.params.id)
    if (!monitor) return res.status(404).json({ message: 'SSL 证书监控不存在' })
    res.json({ data: await updateSslCertificateMonitor(req.params.id, monitorSchema.parse(req.body), req.user!.displayName) })
  } catch (error) {
    next(error)
  }
})

router.delete('/monitors/:id', requirePermission(PERMISSIONS.SSL_CERTIFICATES_MANAGE), async (req, res, next) => {
  try {
    const deleted = await deleteSslCertificateMonitor(req.params.id, req.user!.displayName)
    if (!deleted) return res.status(404).json({ message: 'SSL 证书监控不存在' })
    res.json({ data: deleted })
  } catch (error) {
    next(error)
  }
})

router.post('/monitors/:id/check', requirePermission(PERMISSIONS.SSL_CERTIFICATES_MANAGE), async (req, res, next) => {
  try {
    const monitor = await getSslCertificateMonitor(req.params.id)
    if (!monitor) return res.status(404).json({ message: 'SSL 证书监控不存在' })
    res.json({ data: await checkSslCertificateMonitorNow(req.params.id, { manual: true }) })
  } catch (error) {
    next(error)
  }
})

router.get('/histories', requirePermission(PERMISSIONS.SSL_CERTIFICATES_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await listSslCertificateHistories(typeof req.query.monitorId === 'string' ? req.query.monitorId : undefined) })
  } catch (error) {
    next(error)
  }
})

export default router
