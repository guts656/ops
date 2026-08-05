import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { defaultDashboardTradingSessionSettings, normalizeDashboardTradingSessionSettings, type DashboardTradingSessionSettings } from '../utils/tradingSessions.ts'

export type OutboundNotificationChannel = '站内告警' | '企业微信' | '钉钉'

export interface OutboundChannelSetting {
  enabled: boolean
  webhookUrl?: string
  receivers?: string
  keyword?: string
}

export interface InAppNotificationSetting {
  enabled: boolean
}

export interface OutboundNotificationSettings {
  inApp: InAppNotificationSetting
  dingTalk: OutboundChannelSetting
  weCom: OutboundChannelSetting
}

export const OUTBOUND_NOTIFICATION_SETTING_KEY = 'outboundNotifications'
export const DASHBOARD_TRADING_SESSION_SETTING_KEY = 'dashboardTradingSessions'

type OutboundProvider = 'dingTalk' | 'weCom'

let legacyOutboundMigration: Promise<OutboundNotificationSettings> | undefined

const defaultSettings: OutboundNotificationSettings = {
  inApp: { enabled: true },
  dingTalk: { enabled: false, webhookUrl: '', receivers: '' },
  weCom: { enabled: false, webhookUrl: '', receivers: '' },
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function channelSetting(value: unknown): OutboundChannelSetting {
  const setting = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<OutboundChannelSetting> : {}
  return {
    enabled: Boolean(setting.enabled),
    webhookUrl: text(setting.webhookUrl),
    receivers: text(setting.receivers),
    keyword: text(setting.keyword),
  }
}

export function normalizeOutboundNotificationSettings(value: unknown): OutboundNotificationSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<OutboundNotificationSettings> & { defaultChannels?: OutboundNotificationChannel[] }
    : {}
  const legacyChannels = Array.isArray(raw.defaultChannels) ? raw.defaultChannels : undefined
  const inAppValue = raw.inApp && typeof raw.inApp === 'object' ? raw.inApp.enabled : legacyChannels?.includes('站内告警')

  return {
    inApp: { enabled: inAppValue ?? defaultSettings.inApp.enabled },
    dingTalk: channelSetting(raw.dingTalk),
    weCom: channelSetting(raw.weCom),
  }
}

export function outboundWebhookProvider(value: string): OutboundProvider | undefined {
  try {
    const hostname = new URL(value).hostname.toLowerCase()
    if (hostname === 'dingtalk.com' || hostname.endsWith('.dingtalk.com')) return 'dingTalk'
    if (hostname === 'qyapi.weixin.qq.com') return 'weCom'
  } catch {
    return undefined
  }
  return undefined
}

function notificationWebhook(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ''
  return text((value as { webhookUrl?: unknown }).webhookUrl)
}

async function migrateLegacyRuleWebhooks(current: OutboundNotificationSettings) {
  const [resourceRules, logRules, cgiRules, sslRules] = await Promise.all([
    prisma.hostResourceMonitorRule.findMany({ select: { notification: true } }),
    prisma.logMonitorRule.findMany({ select: { notification: true } }),
    prisma.cgiMonitorRule.findMany({ select: { notification: true } }),
    prisma.sslCertificateMonitor.findMany({ select: { notification: true } }),
  ])
  const candidates: Record<OutboundProvider, Set<string>> = { dingTalk: new Set(), weCom: new Set() }
  const notifications: unknown[] = [
    ...resourceRules.map((rule) => rule.notification),
    ...logRules.map((rule) => rule.notification),
    ...cgiRules.map((rule) => rule.notification),
    ...sslRules.map((rule) => rule.notification),
  ]
  for (const notification of notifications) {
    const webhookUrl = notificationWebhook(notification)
    const provider = outboundWebhookProvider(webhookUrl)
    if (provider) candidates[provider].add(webhookUrl)
  }

  const settings: OutboundNotificationSettings = {
    inApp: { ...current.inApp },
    dingTalk: { ...current.dingTalk },
    weCom: { ...current.weCom },
  }
  const migrated: string[] = []
  for (const provider of ['dingTalk', 'weCom'] as const) {
    const channel = settings[provider]
    if (!channel.enabled || channel.webhookUrl?.trim() || candidates[provider].size !== 1) continue
    channel.webhookUrl = Array.from(candidates[provider])[0]
    migrated.push(provider === 'dingTalk' ? '钉钉' : '企业微信')
  }
  if (!migrated.length) return current

  await prisma.appSetting.upsert({
    where: { key: OUTBOUND_NOTIFICATION_SETTING_KEY },
    update: { value: settings as unknown as Prisma.InputJsonValue },
    create: { key: OUTBOUND_NOTIFICATION_SETTING_KEY, value: settings as unknown as Prisma.InputJsonValue },
  })
  console.log(`Migrated legacy rule webhook to global settings: ${migrated.join(', ')}`)
  return settings
}

export async function getOutboundNotificationSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: OUTBOUND_NOTIFICATION_SETTING_KEY } })
  const settings = normalizeOutboundNotificationSettings(row?.value)
  const needsMigration = (settings.dingTalk.enabled && !settings.dingTalk.webhookUrl?.trim())
    || (settings.weCom.enabled && !settings.weCom.webhookUrl?.trim())
  if (!needsMigration) return settings
  if (!legacyOutboundMigration) {
    legacyOutboundMigration = migrateLegacyRuleWebhooks(settings).catch((error) => {
      console.error('Legacy outbound webhook migration failed:', error)
      return settings
    })
  }
  return legacyOutboundMigration
}

export async function saveOutboundNotificationSettings(input: OutboundNotificationSettings) {
  const settings = normalizeOutboundNotificationSettings(input)
  const row = await prisma.appSetting.upsert({
    where: { key: OUTBOUND_NOTIFICATION_SETTING_KEY },
    update: { value: settings as unknown as Prisma.InputJsonValue },
    create: { key: OUTBOUND_NOTIFICATION_SETTING_KEY, value: settings as unknown as Prisma.InputJsonValue },
  })
  return normalizeOutboundNotificationSettings(row.value)
}

export async function getGlobalWebhookForChannel(channel: OutboundNotificationChannel) {
  const settings = await getOutboundNotificationSettings()
  if (channel === '钉钉') return settings.dingTalk.enabled ? settings.dingTalk.webhookUrl?.trim() || undefined : undefined
  if (channel === '企业微信') return settings.weCom.enabled ? settings.weCom.webhookUrl?.trim() || undefined : undefined
  return undefined
}

export async function getDashboardTradingSessionSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: DASHBOARD_TRADING_SESSION_SETTING_KEY } })
  return normalizeDashboardTradingSessionSettings(row?.value ?? defaultDashboardTradingSessionSettings)
}

export async function saveDashboardTradingSessionSettings(input: DashboardTradingSessionSettings) {
  const settings = normalizeDashboardTradingSessionSettings(input)
  const row = await prisma.appSetting.upsert({
    where: { key: DASHBOARD_TRADING_SESSION_SETTING_KEY },
    update: { value: settings as unknown as Prisma.InputJsonValue },
    create: { key: DASHBOARD_TRADING_SESSION_SETTING_KEY, value: settings as unknown as Prisma.InputJsonValue },
  })
  return normalizeDashboardTradingSessionSettings(row.value)
}
