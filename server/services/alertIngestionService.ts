import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import type { AlertItem, AlertLevel, CreateAlertInput, CreateAlertResult, ExternalSeverity } from '../types/alert'
import { markLatestAlert, processAlert } from './alertNoiseReductionService'
import { shanghaiTime } from '../utils/time'
import { emitAlertEvent } from './realtime'
import { createNotification } from './notificationService'
import { handleAlertWithSelfHealing } from './alertHandlingService'
import { getOutboundNotificationSettings } from '../data/settings'
import { isHostInMaintenance } from '../data/hosts'
import { sendMonitorNotifications } from './outboundNotificationService'

const severityLevelMap: Record<string, AlertLevel> = {
  critical: '紧急',
  high: '严重',
  medium: '警告',
  low: '提示',
  info: '提示',
  紧急: '紧急',
  严重: '严重',
  警告: '警告',
  提示: '提示',
}

function alertId(source = 'alert') {
  return `${source.replace(/[^a-z0-9]+/gi, '-').toLowerCase() || 'alert'}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function toLevel(level?: AlertLevel, severity?: ExternalSeverity): AlertLevel {
  return level || severityLevelMap[String(severity || '').toLowerCase()] || severityLevelMap[String(severity || '')] || '警告'
}

function metadataValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function mergeMetadata(current: unknown, next: Record<string, unknown>, occurrenceCount: number) {
  return {
    ...metadataValue(current),
    ...next,
    lastOccurrence: next,
    occurrenceCount,
  } as Prisma.InputJsonValue
}

async function resolveMaintenanceHostId(input: CreateAlertInput) {
  const metadata = input.metadata ?? {}
  const directHostId = typeof metadata.sourceHostId === 'string' ? metadata.sourceHostId : typeof metadata.hostId === 'string' ? metadata.hostId : typeof metadata.probeHostId === 'string' ? metadata.probeHostId : undefined
  if (directHostId) return directHostId
  if (!input.relatedType || !input.relatedId) return undefined
  if (input.relatedType === 'host_service') return (await prisma.hostService.findUnique({ where: { id: input.relatedId }, select: { hostId: true } }))?.hostId
  if (input.relatedType === 'service_event') return (await prisma.serviceEvent.findUnique({ where: { id: input.relatedId }, select: { hostId: true } }))?.hostId
  if (input.relatedType === 'log_monitor_rule') return (await prisma.logMonitorRule.findUnique({ where: { id: input.relatedId }, select: { hostId: true } }))?.hostId ?? undefined
  if (input.relatedType === 'cgi_monitor_rule') return (await prisma.cgiMonitorRule.findUnique({ where: { id: input.relatedId }, select: { probeHostId: true } }))?.probeHostId ?? undefined
  return undefined
}

function skippedNoise(fingerprint?: string, reason = '主机维护中', suppressionUntil?: Date) {
  return { fingerprint: fingerprint || 'host-maintenance-skipped', shouldNotify: false, isDuplicate: false, isSuppressed: true, occurrenceCount: 0, suppressionReason: reason, suppressionUntil: suppressionUntil?.toISOString() }
}

function manualResolveCooldownMinutes() {
  const value = Number(process.env.ALERT_MANUAL_RESOLVE_COOLDOWN_MINUTES || 10)
  return Number.isFinite(value) && value > 0 ? value : 10
}

async function manuallyResolvedActiveCondition(input: CreateAlertInput, fingerprint: string, now = new Date()) {
  const metadata = input.metadata ?? {}
  if (metadata.allowReopenAfterManualResolve === true) return false
  if (!input.relatedType || !input.relatedId) return false
  const latest = await prisma.alert.findFirst({ where: { fingerprint }, orderBy: { updatedAt: 'desc' }, select: { id: true, status: true, metadata: true, updatedAt: true } })
  if (latest?.status !== '已解决') return false
  const latestMetadata = metadataValue(latest.metadata)
  if (latestMetadata.recoveredAfterResolve === true) return false
  const cooldownUntil = new Date(latest.updatedAt.getTime() + manualResolveCooldownMinutes() * 60_000)
  return cooldownUntil > now ? cooldownUntil : false
}

async function outboundNotificationForAlert(input: CreateAlertInput) {
  if (input.outboundNotification) return input.outboundNotification
  const settings = await getOutboundNotificationSettings()
  return { channels: settings.defaultChannels }
}

async function sendGlobalAlertNotification(input: CreateAlertInput, alert: AlertItem) {
  const ruleNotification = await outboundNotificationForAlert(input)
  const content = [
    `【${alert.level}】${alert.title || alert.service}`,
    alert.content,
    `来源：${alert.source}`,
    `服务/对象：${alert.service}`,
    `时间：${alert.time}`,
  ].join('\n')
  return sendMonitorNotifications({ ruleNotification, content })
}

export function toAlertItem(alert: any): AlertItem {
  return {
    id: alert.id,
    level: alert.level as AlertItem['level'],
    time: alert.time,
    service: alert.service,
    content: alert.content,
    owner: alert.owner,
    status: alert.status as AlertItem['status'],
    diagnosis: alert.diagnosis ?? undefined,
    acknowledgedAt: alert.acknowledgedAt ?? undefined,
    resolvedAt: alert.resolvedAt ?? undefined,
    source: alert.source ?? '平台',
    title: alert.title ?? alert.content?.slice?.(0, 80),
    metadata: metadataValue(alert.metadata),
    fingerprint: alert.fingerprint ?? undefined,
    occurrenceCount: alert.occurrenceCount ?? 1,
    firstOccurrenceAt: alert.firstOccurrenceAt?.toISOString?.(),
    lastOccurrenceAt: alert.lastOccurrenceAt?.toISOString?.(),
    isSuppressed: alert.isSuppressed ?? false,
    suppressionReason: alert.suppressionReason ?? undefined,
    suppressionUntil: alert.suppressionUntil?.toISOString?.(),
    relatedType: alert.relatedType ?? undefined,
    relatedId: alert.relatedId ?? undefined,
    createdAt: alert.createdAt?.toISOString?.(),
    updatedAt: alert.updatedAt?.toISOString?.(),
  }
}

export async function ingestAlert(input: CreateAlertInput): Promise<CreateAlertResult> {
  const level = toLevel(input.level, input.severity)
  const source = input.source?.trim() || '平台'
  const service = input.service?.trim() || '未指定服务'
  const content = input.content.trim()
  const title = input.title?.trim() || content.slice(0, 80)
  const owner = input.owner?.trim() || source
  const metadata = input.metadata ?? {}
  const now = new Date()
  const maintenanceHostId = await resolveMaintenanceHostId(input)
  if (maintenanceHostId && await isHostInMaintenance(maintenanceHostId, now)) {
    return { noiseReduction: skippedNoise(input.fingerprint), skipped: true, skippedReason: 'host_maintenance' }
  }
  const fingerprint = input.fingerprint || undefined
  const manualCooldownUntil = fingerprint ? await manuallyResolvedActiveCondition(input, fingerprint, now) : false
  if (fingerprint && manualCooldownUntil) {
    return { noiseReduction: skippedNoise(fingerprint, '人工已解决，冷却期内暂不重复告警', manualCooldownUntil), skipped: true, skippedReason: 'manual_resolved' }
  }
  const noiseReduction = await processAlert({ source, title, service, content, level, fingerprint: input.fingerprint })

  const activeDuplicate = await prisma.alert.findFirst({
    where: { fingerprint: noiseReduction.fingerprint, status: { not: '已解决' } },
    orderBy: { updatedAt: 'desc' },
  })

  const alert = activeDuplicate
    ? await prisma.alert.update({
      where: { id: activeDuplicate.id },
      data: {
        level,
        time: input.time || shanghaiTime(now),
        service,
        content,
        owner,
        source,
        title,
        metadata: mergeMetadata(activeDuplicate.metadata, metadata, noiseReduction.occurrenceCount),
        occurrenceCount: noiseReduction.occurrenceCount,
        lastOccurrenceAt: now,
        isSuppressed: noiseReduction.isSuppressed,
        suppressionReason: noiseReduction.suppressionReason ?? null,
        suppressionUntil: noiseReduction.suppressionUntil ? new Date(noiseReduction.suppressionUntil) : null,
        relatedType: input.relatedType ?? activeDuplicate.relatedType,
        relatedId: input.relatedId ?? activeDuplicate.relatedId,
      },
    })
    : await prisma.alert.create({
      data: {
        id: input.id || alertId(source),
        level,
        time: input.time || shanghaiTime(now),
        service,
        content,
        owner,
        status: '待处理',
        source,
        title,
        metadata: metadata as Prisma.InputJsonValue,
        fingerprint: noiseReduction.fingerprint,
        occurrenceCount: noiseReduction.occurrenceCount,
        firstOccurrenceAt: now,
        lastOccurrenceAt: now,
        isSuppressed: noiseReduction.isSuppressed,
        suppressionReason: noiseReduction.suppressionReason ?? null,
        suppressionUntil: noiseReduction.suppressionUntil ? new Date(noiseReduction.suppressionUntil) : null,
        relatedType: input.relatedType,
        relatedId: input.relatedId,
      },
    })

  await markLatestAlert(noiseReduction.fingerprint, alert.id)
  const alertItem = toAlertItem(alert)
  emitAlertEvent(activeDuplicate ? 'alert:updated' : 'alert:new', alertItem)
  if (!alertItem.isSuppressed) {
    await createNotification({
      type: 'alert',
      level: alertItem.level === '紧急' || alertItem.level === '严重' ? 'error' : 'warning',
      title: `${activeDuplicate ? '持续告警' : '新告警'}：${alertItem.title || alertItem.service}`,
      content: alertItem.content,
      entityType: 'alert',
      entityId: alertItem.id,
      metadata: { source: alertItem.source, level: alertItem.level, repeated: Boolean(activeDuplicate), occurrenceCount: alertItem.occurrenceCount },
    })
    const notificationResults = await sendGlobalAlertNotification(input, alertItem)
    if (notificationResults.length) {
      await prisma.alert.update({
        where: { id: alertItem.id },
        data: { metadata: { ...alertItem.metadata, outboundNotificationResults: notificationResults } as Prisma.InputJsonValue },
      })
      alertItem.metadata = { ...alertItem.metadata, outboundNotificationResults: notificationResults }
    }
    if (!activeDuplicate) await handleAlertWithSelfHealing(alertItem)
  }
  return { alert: alertItem, noiseReduction }
}
