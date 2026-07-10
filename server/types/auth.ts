import type { Request } from 'express'
import type { Permission, Role } from '../config/permissions'

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

export interface AuthRequest extends Request {
  user?: AuthUser
}

export interface TokenPayload {
  username: string
  role: Role
  tokenVersion: number
}
