import { Router } from 'express'
import { ZodError, z } from 'zod'
import { recordHostMetrics } from '../data/hosts.ts'
import { ingestHostContainers } from '../data/hostContainers.ts'
import { ingestHostServices, ingestServiceEvents } from '../data/hostServices.ts'
import { getHostLogCollectionPaths } from '../data/logCollectionRules.ts'
import { ingestAgentLogs } from '../data/logs.ts'
import { authenticateAgentHost, touchAgentHeartbeat } from '../utils/agentAuth.ts'
import { alertAgentLogUploadFailure } from '../services/agentLogUploadWatchdog.ts'

const router = Router()

const metricsSchema = z.object({
  cpu: z.coerce.number().min(0).max(100),
  memory: z.coerce.number().min(0).max(100),
  disk: z.coerce.number().min(0).max(100),
  hostname: z.string().min(1).optional(),
  osVersion: z.string().min(1).optional(),
  uptimeSeconds: z.coerce.number().int().min(0).optional(),
  sampledAt: z.string().datetime().optional(),
})

const logLevelSchema = z.enum(['ERROR', 'WARN', 'INFO', 'DEBUG'])
const logsSchema = z.object({
  logs: z.array(z.object({
    timestamp: z.string().datetime().optional(),
    service: z.string().min(1),
    level: logLevelSchema,
    traceId: z.string().optional(),
    message: z.string().min(1),
    source: z.string().optional(),
    labels: z.unknown().optional(),
    rawPayload: z.unknown().optional(),
  })).min(1).max(100),
})
const servicesSchema = z.object({
  services: z.array(z.object({
    name: z.string().min(1),
    status: z.string().min(1),
    port: z.coerce.number().int().min(0).max(65535).optional(),
    protocol: z.string().optional(),
    version: z.string().optional(),
    pid: z.coerce.number().int().min(0).optional(),
    source: z.string().optional(),
    metadata: z.unknown().optional(),
    lastReportedAt: z.string().datetime().optional(),
  })).min(1).max(200),
})
const serviceEventsSchema = z.object({
  events: z.array(z.object({
    service: z.string().min(1),
    eventType: z.string().min(1),
    level: z.string().min(1),
    message: z.string().min(1),
    occurredAt: z.string().datetime().optional(),
    source: z.string().optional(),
    payload: z.unknown().optional(),
  })).min(1).max(200),
})
const nullableNumberSchema = z.coerce.number().nullish()
const nullableIntSchema = z.coerce.number().int().nullish()
const nullableBytesSchema = z.union([z.string(), z.number()]).nullish()
const nullableDateTimeSchema = z.string().datetime().nullish()

const containersSchema = z.object({
  containers: z.array(z.object({
    containerId: z.string().min(1),
    name: z.string().min(1),
    image: z.string().min(1),
    status: z.string().min(1),
    state: z.string().min(1),
    restartCount: nullableIntSchema,
    ports: z.unknown().optional(),
    cpuPercent: nullableNumberSchema,
    memoryUsageBytes: nullableBytesSchema,
    memoryLimitBytes: nullableBytesSchema,
    memoryPercent: nullableNumberSchema,
    networkRxBytes: nullableBytesSchema,
    networkTxBytes: nullableBytesSchema,
    blockReadBytes: nullableBytesSchema,
    blockWriteBytes: nullableBytesSchema,
    labels: z.unknown().optional(),
    startedAt: nullableDateTimeSchema,
    lastReportedAt: nullableDateTimeSchema,
  })).max(300),
})

router.post('/hosts/:id/metrics', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    const values = metricsSchema.parse(req.body)
    await recordHostMetrics(auth.host.id, { ...values, sampledAt: values.sampledAt ? new Date(values.sampledAt) : undefined })
    res.json({ ok: true })
  } catch (error) {
    next(error)
  }
})

router.get('/hosts/:id/log-config', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })
    res.json({ paths: await getHostLogCollectionPaths(auth.host.id) })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/logs', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    const parsed = logsSchema.safeParse(req.body)
    if (!parsed.success) {
      const sample = Array.isArray(req.body?.logs) ? req.body.logs.slice(0, 3).map((log: unknown) => {
        const item = log && typeof log === 'object' && !Array.isArray(log) ? log as Record<string, unknown> : {}
        return {
          timestamp: item.timestamp,
          serviceType: typeof item.service,
          serviceLength: typeof item.service === 'string' ? item.service.length : undefined,
          level: item.level,
          messageType: typeof item.message,
          messageLength: typeof item.message === 'string' ? item.message.length : undefined,
          sourceType: typeof item.source,
          traceIdType: typeof item.traceId,
        }
      }) : []
      console.warn('[agent-logs] invalid payload', { hostId: auth.host.id, issues: parsed.error.issues, sample })
      alertAgentLogUploadFailure(auth.host.id, '日志上传参数不正确，后端已拒绝入库', { issues: parsed.error.issues, sample }).catch((error) => console.error('Agent log upload alert failed:', error))
      return next(new ZodError(parsed.error.issues))
    }

    const count = await ingestAgentLogs(auth.host.id, parsed.data.logs)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/services', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    const { services } = servicesSchema.parse(req.body)
    const count = await ingestHostServices(auth.host.id, services)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/service-events', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    const { events } = serviceEventsSchema.parse(req.body)
    const count = await ingestServiceEvents(auth.host.id, events)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

router.post('/hosts/:id/containers', async (req, res, next) => {
  try {
    const auth = await authenticateAgentHost(req)
    if ('status' in auth) return res.status(auth.status).json({ message: auth.message })

    const { containers } = containersSchema.parse(req.body)
    const count = await ingestHostContainers(auth.host.id, containers)
    await touchAgentHeartbeat(auth.host.id)
    res.json({ ok: true, count })
  } catch (error) {
    next(error)
  }
})

export default router
