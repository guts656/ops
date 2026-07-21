import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { defaultDashboardTradingSessionSettings, normalizeDashboardTradingSessionSettings, type DashboardTradingSessionSettings } from '../utils/tradingSessions.ts'

export type OutboundNotificationChannel = '站内告警' | '企业微信' | '钉钉'

export interface OutboundChannelSetting {
  enabled: boolean
  webhookUrl?: string
  receivers?: string
}

export interface OutboundNotificationSettings {
  defaultChannels: OutboundNotificationChannel[]
  dingTalk: OutboundChannelSetting
  weCom: OutboundChannelSetting
}

export const OUTBOUND_NOTIFICATION_SETTING_KEY = 'outboundNotifications'
export const DASHBOARD_TRADING_SESSION_SETTING_KEY = 'dashboardTradingSessions'

const defaultSettings: OutboundNotificationSettings = {
  defaultChannels: ['站内告警'],
  dingTalk: { enabled: false, webhookUrl: '', receivers: '' },
  weCom: { enabled: false, webhookUrl: '', receivers: '' },
}

const allowedChannels = new Set<OutboundNotificationChannel>(['站内告警', '企业微信', '钉钉'])

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function channelSetting(value: unknown): OutboundChannelSetting {
  const setting = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<OutboundChannelSetting> : {}
  return {
    enabled: Boolean(setting.enabled),
    webhookUrl: text(setting.webhookUrl),
    receivers: text(setting.receivers),
  }
}

export function normalizeOutboundNotificationSettings(value: unknown): OutboundNotificationSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<OutboundNotificationSettings> : {}
  const defaultChannels = Array.isArray(raw.defaultChannels)
    ? Array.from(new Set(raw.defaultChannels.filter((channel): channel is OutboundNotificationChannel => allowedChannels.has(channel as OutboundNotificationChannel))))
    : defaultSettings.defaultChannels

  return {
    defaultChannels: defaultChannels.length ? defaultChannels : defaultSettings.defaultChannels,
    dingTalk: channelSetting(raw.dingTalk),
    weCom: channelSetting(raw.weCom),
  }
}

export async function getOutboundNotificationSettings() {
  const row = await prisma.appSetting.findUnique({ where: { key: OUTBOUND_NOTIFICATION_SETTING_KEY } })
  return normalizeOutboundNotificationSettings(row?.value)
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
