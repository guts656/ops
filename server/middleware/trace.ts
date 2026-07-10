import { randomUUID } from 'node:crypto'
import type { NextFunction, Request, Response } from 'express'

type TraceRequest = Request & { traceId?: string }

function getTraceId(req: Request) {
  const value = req.headers['x-trace-id']
  if (Array.isArray(value)) return value[0] || randomUUID()
  return value || randomUUID()
}

export function traceMiddleware(req: TraceRequest, res: Response, next: NextFunction) {
  const startedAt = Date.now()
  const traceId = getTraceId(req)
  req.traceId = traceId
  res.setHeader('X-Trace-Id', traceId)

  res.on('finish', () => {
    const durationMs = Date.now() - startedAt
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info'
    const message = `[${traceId}] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs}ms`
    if (level === 'error') console.error(message)
    else if (level === 'warn') console.warn(message)
    else console.log(message)
  })

  next()
}

export function requestTraceId(req: Request) {
  return (req as TraceRequest).traceId
}
