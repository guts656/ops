import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate'
import { getUnreadNotificationCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '../services/notificationService'

const querySchema = z.object({
  unreadOnly: z.preprocess((value) => value === 'true' ? true : value === 'false' ? false : value, z.boolean().optional()),
  limit: z.coerce.number().int().positive().max(100).optional(),
})

const router = Router()

router.use(authenticate)

router.get('/', async (req, res, next) => {
  try {
    const filters = querySchema.parse(req.query)
    res.json({ data: await listNotifications(filters) })
  } catch (error) {
    next(error)
  }
})

router.get('/unread-count', async (_req, res, next) => {
  try {
    res.json({ data: { count: await getUnreadNotificationCount() } })
  } catch (error) {
    next(error)
  }
})

router.patch('/read-all', async (_req, res, next) => {
  try {
    res.json({ data: await markAllNotificationsRead() })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/read', async (req, res, next) => {
  try {
    res.json({ data: await markNotificationRead(req.params.id) })
  } catch (error) {
    next(error)
  }
})

export default router
