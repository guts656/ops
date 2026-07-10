import type { NextFunction, Request, Response } from 'express'
import { ZodError } from 'zod'
import { isProduction } from '../config/env.ts'
import { requestTraceId } from './trace.ts'

const businessErrors = [
  '用户名已存在',
  '未知角色',
  '包含未知权限',
  '不能禁用或删除最后一个启用的管理员',
  '不能禁用当前登录账号',
  '不能删除当前登录账号',
  '日志监控规则至少需要一个关键字',
]

export function errorHandler(error: unknown, req: Request, res: Response, _next: NextFunction) {
  const traceId = requestTraceId(req)

  if (error instanceof ZodError) {
    return res.status(400).json({ message: '请求参数不正确', issues: error.issues, traceId })
  }

  const rawMessage = error instanceof Error ? error.message : '服务器内部错误'
  const status = businessErrors.includes(rawMessage) ? 400 : 500
  if (status >= 500) console.error(`[${traceId || '-'}] Unhandled request error:`, error)
  const message = status >= 500 && isProduction ? '服务器内部错误' : rawMessage
  return res.status(status).json({ message, traceId })
}
