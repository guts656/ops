import { createHash } from 'node:crypto'
import { prisma } from '../db/prisma'
import type { AlertLevel, AlertNoiseStats, CreateAlertInput, SuppressedAlertRecord } from '../types/alert'

const AUTO_SUPPRESS_ENABLED = process.env.ALERT_AUTO_SUPPRESS_ENABLED === 'true'
const AUTO_SUPPRESS_THRESHOLD = 5
const AUTO_SUPPRESS_MINUTES = 30
const NEVER_AUTO_SUPPRESS_LEVELS: AlertLevel[] = ['紧急', '严重']

function normalizeFingerprintPart(value: string | undefined) {
  return (value ?? '')
    .toLowerCase()
    .replace(/[\d_\-\s:：/\\.]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function toIso(value: Date | string | null | undefined) {
  if (!value) return undefined
  return (typeof value === 'string' ? new Date(value) : value).toISOString()
}

function isAutoSuppressionReason(reason?: string | null) {
  return Boolean(reason?.startsWith('同类告警重复达到'))
}

function toRecord(record: any): SuppressedAlertRecord {
  return {
    id: record.id,
    fingerprint: record.fingerprint,
    source: record.source,
    title: record.title,
    service: record.service,
    level: record.level,
    occurrenceCount: record.occurrenceCount,
    firstOccurrenceAt: record.firstOccurrenceAt.toISOString(),
    lastOccurrenceAt: record.lastOccurrenceAt.toISOString(),
    isSuppressed: record.isSuppressed,
    suppressionReason: record.suppressionReason ?? undefined,
    suppressionUntil: toIso(record.suppressionUntil),
    latestAlertId: record.latestAlertId ?? undefined,
  }
}

export function generateFingerprint(source: string, title: string, content?: string) {
  const normalized = [source, title, content].map(normalizeFingerprintPart).filter(Boolean).join('|')
  return createHash('md5').update(normalized || 'alert').digest('hex')
}

export async function processAlert(input: Required<Pick<CreateAlertInput, 'content'>> & Pick<CreateAlertInput, 'source' | 'title' | 'service'> & { level: AlertLevel; fingerprint?: string }) {
  const now = new Date()
  const source = input.source || '平台'
  const title = input.title || input.content.slice(0, 80)
  const service = input.service || '未指定服务'
  const fingerprint = input.fingerprint || generateFingerprint(source, title, input.content)
  const existing = await prisma.alertNoiseRecord.findUnique({ where: { fingerprint } })
  const existingSuppressionExpired = Boolean(existing?.suppressionUntil && existing.suppressionUntil <= now)
  const occurrenceCount = (existing?.occurrenceCount ?? 0) + 1
  const canAutoSuppress = AUTO_SUPPRESS_ENABLED && !NEVER_AUTO_SUPPRESS_LEVELS.includes(input.level)
  const autoSuppressed = canAutoSuppress && occurrenceCount >= AUTO_SUPPRESS_THRESHOLD
  const existingSuppressed = Boolean(existing?.isSuppressed && !existingSuppressionExpired && (AUTO_SUPPRESS_ENABLED || !isAutoSuppressionReason(existing.suppressionReason)))
  const isSuppressed = existingSuppressed || autoSuppressed
  const suppressionUntil = existingSuppressed ? existing?.suppressionUntil : autoSuppressed ? new Date(now.getTime() + AUTO_SUPPRESS_MINUTES * 60_000) : null
  const suppressionReason = existingSuppressed
    ? existing?.suppressionReason || '手动抑制'
    : autoSuppressed
      ? `同类告警重复达到 ${AUTO_SUPPRESS_THRESHOLD} 次，自动抑制 ${AUTO_SUPPRESS_MINUTES} 分钟`
      : null

  await prisma.alertNoiseRecord.upsert({
    where: { fingerprint },
    create: {
      fingerprint,
      source,
      title,
      service,
      level: input.level,
      occurrenceCount,
      firstOccurrenceAt: now,
      lastOccurrenceAt: now,
      isSuppressed,
      suppressionReason,
      suppressionUntil,
    },
    update: {
      source,
      title,
      service,
      level: input.level,
      occurrenceCount,
      lastOccurrenceAt: now,
      isSuppressed,
      suppressionReason,
      suppressionUntil,
    },
  })

  return {
    fingerprint,
    shouldNotify: !isSuppressed,
    isDuplicate: Boolean(existing),
    isSuppressed,
    occurrenceCount,
    suppressionReason: suppressionReason ?? undefined,
    suppressionUntil: toIso(suppressionUntil),
  }
}

export async function markLatestAlert(fingerprint: string, alertId: string) {
  await prisma.alertNoiseRecord.update({ where: { fingerprint }, data: { latestAlertId: alertId } })
}

export async function getNoiseReductionStats(): Promise<AlertNoiseStats> {
  const records = await prisma.alertNoiseRecord.findMany({ select: { occurrenceCount: true, isSuppressed: true } })
  const totalOccurrences = records.reduce((sum, record) => sum + record.occurrenceCount, 0)
  const duplicateOccurrences = records.reduce((sum, record) => sum + Math.max(0, record.occurrenceCount - 1), 0)
  return {
    totalFingerprints: records.length,
    suppressedFingerprints: records.filter((record) => record.isSuppressed).length,
    totalOccurrences,
    duplicateOccurrences,
    noiseReductionRate: totalOccurrences ? Math.round((duplicateOccurrences / totalOccurrences) * 1000) / 10 : 0,
  }
}

export async function listSuppressedAlerts() {
  const records = await prisma.alertNoiseRecord.findMany({ where: { isSuppressed: true }, orderBy: { lastOccurrenceAt: 'desc' }, take: 100 })
  return records.map(toRecord)
}

export async function suppressFingerprint(fingerprint: string, reason: string, durationMinutes?: number) {
  const suppressionUntil = durationMinutes ? new Date(Date.now() + durationMinutes * 60_000) : null
  const record = await prisma.alertNoiseRecord.update({
    where: { fingerprint },
    data: { isSuppressed: true, suppressionReason: reason, suppressionUntil },
  })
  await prisma.alert.updateMany({ where: { fingerprint }, data: { isSuppressed: true, suppressionReason: reason, suppressionUntil } })
  return toRecord(record)
}

export async function unsuppressFingerprint(fingerprint: string) {
  const record = await prisma.alertNoiseRecord.update({
    where: { fingerprint },
    data: { isSuppressed: false, suppressionReason: null, suppressionUntil: null },
  })
  await prisma.alert.updateMany({ where: { fingerprint }, data: { isSuppressed: false, suppressionReason: null, suppressionUntil: null } })
  return toRecord(record)
}
