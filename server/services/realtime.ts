import { Server as HttpServer } from 'node:http'
import { Server } from 'socket.io'
import { corsOrigin } from '../config/env'
import { findStoredUser, toAuthUser } from '../data/users'
import { verifyToken } from '../utils/jwt'

let io: Server | undefined

export function setupRealtime(server: HttpServer) {
  io = new Server(server, { cors: { origin: corsOrigin } })

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.headers.authorization?.toString().replace(/^Bearer\s+/i, '')
      if (!token) return next(new Error('请先登录'))
      const payload = verifyToken(token)
      const storedUser = await findStoredUser(payload.username)
      if (!storedUser || !storedUser.enabled || storedUser.tokenVersion !== payload.tokenVersion) return next(new Error('登录已过期'))
      socket.data.user = toAuthUser(storedUser)
      next()
    } catch {
      next(new Error('登录已过期'))
    }
  })

  io.on('connection', (socket) => {
    socket.on('alert:subscribe', () => socket.join('alerts'))
    socket.on('notification:subscribe', () => socket.join('notifications'))
    socket.on('self-healing:subscribe', () => socket.join('self-healing'))
  })

  return io
}

export function emitAlertEvent(event: 'alert:new' | 'alert:updated' | 'alert:resolved', data: unknown) {
  io?.to('alerts').emit(event, data)
}

export function emitNotificationEvent(data: unknown) {
  io?.to('notifications').emit('notification:new', data)
}

export function emitSelfHealingEvent(data: unknown) {
  io?.to('self-healing').emit('self-healing:triggered', data)
}
