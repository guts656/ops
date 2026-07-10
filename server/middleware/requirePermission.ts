import type { NextFunction, Response } from 'express'
import type { Permission } from '../config/permissions'
import type { AuthRequest } from '../types/auth'

export function requirePermission(permission: Permission) {
  return (req: AuthRequest, res: Response, next: NextFunction) => {
    if (!req.user) return res.status(401).json({ message: '请先登录' })
    if (!req.user.permissions.includes(permission)) {
      return res.status(403).json({ message: '当前角色无权限执行该操作' })
    }
    next()
  }
}
