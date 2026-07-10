import { io } from 'socket.io-client'

const AUTH_STORAGE_KEY = 'ops-platform.auth.session'
let socket

function readToken() {
  try {
    const session = JSON.parse(window.localStorage.getItem(AUTH_STORAGE_KEY) || '{}')
    return session.token
  } catch {
    return undefined
  }
}

export function getRealtimeSocket() {
  const token = readToken()
  if (!token) return undefined
  if (!socket || socket.disconnected) {
    socket = io('/', { auth: { token }, transports: ['websocket', 'polling'] })
  }
  return socket
}

export function closeRealtimeSocket() {
  socket?.disconnect()
  socket = undefined
}
