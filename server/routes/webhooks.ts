import { createHash, timingSafeEqual } from 'node:crypto'
import { Router } from 'express'
import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { resolveAlert } from '../data/alerts'
import { ingestAlert } from '../services/alertIngestionService'
import { adaptWebhook } from '../services/alertSourceAdapters'

const router = Router()
const allowedSources = new Set(['prometheus', 'zabbix', 'grafana', 'auto', 'generic'])

function tokenFor(source: string) {
  const key = source === 'auto' ? 'GENERIC' : source.toUpperCase()
  return process.env[`${key}_WEBHOOK_TOKEN`] || process.env.GENERIC_WEBHOOK_TOKEN
}

function safeEqual(provided: string, expected: string) {
  const providedDigest = createHash('sha256').update(provided).digest()
  const expectedDigest = createHash('sha256').update(expected).digest()
  return timingSafeEqual(providedDigest, expectedDigest)
}

function verifyToken(source: string, req: { headers: Record<string, unknown> }) {
  const expected = tokenFor(source)
  if (!expected) return false
  const provided = req.headers['x-webhook-token']
  const token = Array.isArray(provided) ? provided[0] : provided?.toString()
  return token ? safeEqual(token, expected) : false
}

function redactSensitive(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSensitive)
  if (!value || typeof value !== 'object') return value
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => {
    const normalized = key.toLowerCase()
    const sensitive = ['authorization', 'credential', 'key', 'password', 'secret', 'token'].some((word) => normalized.includes(word))
    return [key, sensitive ? '[REDACTED]' : redactSensitive(item)]
  }))
}

function clientIp(req: any) {
  return req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim() || req.socket.remoteAddress || undefined
}

async function writeWebhookLog(input: {
  source: string
  status: string
  alertCount?: number
  resolvedCount?: number
  errorMessage?: string
  requestBody?: unknown
  ipAddress?: string
  userAgent?: string
  processingTimeMs: number
}) {
  await prisma.alertWebhookLog.create({
    data: {
      source: input.source,
      status: input.status,
      alertCount: input.alertCount ?? 0,
      resolvedCount: input.resolvedCount ?? 0,
      errorMessage: input.errorMessage,
      requestBody: input.requestBody as Prisma.InputJsonValue,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      processingTimeMs: input.processingTimeMs,
    },
  })
}

async function resolveWebhookAlert(alert: ReturnType<typeof adaptWebhook>[number]) {
  const matched = await prisma.alert.findFirst({
    where: {
      source: alert.source,
      status: { not: '已解决' },
      OR: [
        alert.externalId ? { relatedType: 'webhook', relatedId: alert.externalId } : {},
        { title: alert.title, service: alert.service || alert.host || alert.source },
      ],
    },
    orderBy: { updatedAt: 'desc' },
  })
  if (!matched) return undefined
  return resolveAlert(matched.id, `${alert.source}-webhook`)
}

router.post('/:source', async (req, res, next) => {
  const startedAt = Date.now()
  const source = String(req.params.source || '').toLowerCase()
  if (!allowedSources.has(source)) return res.status(404).json({ message: '不支持的 webhook 来源' })

  if (!verifyToken(source, req)) {
    await writeWebhookLog({ source, status: 'unauthorized', errorMessage: 'invalid webhook token', ipAddress: clientIp(req), userAgent: req.headers['user-agent'], processingTimeMs: Date.now() - startedAt })
    return res.status(401).json({ message: 'Webhook token 无效' })
  }

  try {
    const normalized = adaptWebhook(source, req.body)
    let alertCount = 0
    let resolvedCount = 0
    const alerts = []

    for (const item of normalized) {
      if (item.status === 'resolved') {
        const resolved = await resolveWebhookAlert(item)
        if (resolved) resolvedCount += 1
        continue
      }

      const result = await ingestAlert({
        severity: item.severity,
        source: item.source,
        service: item.service || item.host || item.source,
        title: item.title,
        content: item.content,
        owner: `${item.source}-webhook`,
        relatedType: 'webhook',
        relatedId: item.externalId,
        metadata: { ...item.metadata, externalId: item.externalId, host: item.host, webhookSource: source },
      })
      alertCount += 1
      alerts.push(result.alert)
    }

    await writeWebhookLog({ source, status: 'success', alertCount, resolvedCount, requestBody: redactSensitive(req.body), ipAddress: clientIp(req), userAgent: req.headers['user-agent'], processingTimeMs: Date.now() - startedAt })
    res.json({ success: true, data: { alertCount, resolvedCount, alerts } })
  } catch (error) {
    await writeWebhookLog({ source, status: 'failed', errorMessage: error instanceof Error ? error.message : String(error), requestBody: redactSensitive(req.body), ipAddress: clientIp(req), userAgent: req.headers['user-agent'], processingTimeMs: Date.now() - startedAt })
    next(error)
  }
})

export default router
