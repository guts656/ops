import { Router } from 'express'
import { z } from 'zod'
import { authenticate } from '../middleware/authenticate'
import type { AuthRequest } from '../types/auth'
import { signToken } from '../utils/jwt'
import { verifyUser } from '../data/users'

const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
})

const loginFailures = new Map<string, { count: number; firstFailedAt: number; blockedUntil?: number }>()
const loginWindowMs = 10 * 60 * 1000
const loginBlockMs = 15 * 60 * 1000
const maxLoginFailures = 5

function loginKey(req: AuthRequest, username: string) {
  const forwarded = req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()
  return `${forwarded || req.ip || req.socket.remoteAddress || 'unknown'}:${username.trim().toLowerCase()}`
}

function isLoginBlocked(key: string) {
  const current = loginFailures.get(key)
  if (!current?.blockedUntil) return false
  if (current.blockedUntil <= Date.now()) {
    loginFailures.delete(key)
    return false
  }
  return true
}

function recordLoginFailure(key: string) {
  const now = Date.now()
  const current = loginFailures.get(key)
  const next = !current || now - current.firstFailedAt > loginWindowMs
    ? { count: 1, firstFailedAt: now }
    : { ...current, count: current.count + 1 }
  if (next.count >= maxLoginFailures) next.blockedUntil = now + loginBlockMs
  loginFailures.set(key, next)
}

const router = Router()

router.post('/login', async (req: AuthRequest, res, next) => {
  try {
    const values = loginSchema.parse(req.body)
    const key = loginKey(req, values.username)
    if (isLoginBlocked(key)) return res.status(429).json({ message: '登录失败次数过多，请稍后再试' })

    const user = await verifyUser(values.username, values.password)
    if (!user) {
      recordLoginFailure(key)
      return res.status(401).json({ message: '账号或密码错误，请检查后重试' })
    }

    loginFailures.delete(key)
    const token = signToken(user)
    return res.json({ user, token })
  } catch (error) {
    next(error)
  }
})

router.get('/me', authenticate, (req: AuthRequest, res) => {
  return res.json({ user: req.user })
})

router.post('/logout', authenticate, (_req, res) => {
  return res.json({ success: true })
})

export default router
