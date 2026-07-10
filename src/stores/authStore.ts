import { create } from 'zustand'
import { PERMISSIONS, type Permission, type Role } from '../config/permissions'
import { getErrorMessage, http } from '../api/http'

const AUTH_STORAGE_KEY = 'ops-platform.auth.session'

export interface AuthUser {
  id: string
  username: string
  displayName: string
  role: Role
  title: string
  enabled: boolean
  tokenVersion: number
  permissions: Permission[]
}

interface AuthSession {
  user: AuthUser
  token: string
}

interface AuthStore {
  user?: AuthUser
  token?: string
  isAuthenticated: boolean
  login: (username: string, password: string) => Promise<AuthUser>
  loadCurrentUser: () => Promise<AuthUser | undefined>
  logout: () => void
  hasPermission: (permission?: Permission) => boolean
  hasAnyPermission: (permissions: Permission[]) => boolean
  getDefaultPath: () => string
}

function readSession(): AuthSession | undefined {
  const saved = window.localStorage.getItem(AUTH_STORAGE_KEY)
  if (!saved) return undefined

  try {
    return JSON.parse(saved) as AuthSession
  } catch {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    return undefined
  }
}

const session = readSession()

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: session?.user,
  token: session?.token,
  isAuthenticated: Boolean(session?.token),
  async login(username, password) {
    try {
      const response = await http.post<AuthSession>('/auth/login', { username, password })
      const { user, token } = response.data
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user, token }))
      set({ user, token, isAuthenticated: true })
      return user
    } catch (error) {
      throw new Error(getErrorMessage(error, '登录失败'))
    }
  },
  async loadCurrentUser() {
    const token = get().token
    if (!token) return undefined

    try {
      const response = await http.get<{ user: AuthUser }>('/auth/me')
      const user = response.data.user
      window.localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ user, token }))
      set({ user, token, isAuthenticated: true })
      return user
    } catch {
      get().logout()
      return undefined
    }
  },
  logout() {
    window.localStorage.removeItem(AUTH_STORAGE_KEY)
    set({ user: undefined, token: undefined, isAuthenticated: false })
  },
  hasPermission(permission) {
    if (!permission) return true
    const user = get().user
    if (!user) return false
    if (user.role === 'admin') return true
    return user.permissions.includes(permission)
  },
  hasAnyPermission(permissions) {
    if (!permissions.length) return true
    return permissions.some((permission) => get().hasPermission(permission))
  },
  getDefaultPath() {
    if (get().hasPermission(PERMISSIONS.DASHBOARD_VIEW)) return '/'
    if (get().hasPermission(PERMISSIONS.HOSTS_VIEW)) return '/hosts'
    if (get().hasPermission(PERMISSIONS.AI_VIEW)) return '/ai'
    return '/403'
  },
}))

export function getCurrentOperator() {
  return useAuthStore.getState().user?.displayName ?? 'current.user'
}
