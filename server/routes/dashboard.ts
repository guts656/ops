import { Router } from 'express'
import { PERMISSIONS } from '../config/permissions'
import { getDashboardData } from '../data/dashboard'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'

const router = Router()

router.use(authenticate)

router.get('/', requirePermission(PERMISSIONS.DASHBOARD_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getDashboardData() })
  } catch (error) {
    next(error)
  }
})

export default router
