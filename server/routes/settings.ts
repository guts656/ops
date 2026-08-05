import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions.ts'
import { getDashboardTradingSessionSettings, getOutboundNotificationSettings, saveDashboardTradingSessionSettings, saveOutboundNotificationSettings } from '../data/settings.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { requirePermission } from '../middleware/requirePermission.ts'
import { sendNotificationTest } from '../services/outboundNotificationService.ts'

const outboundChannelSchema = z.enum(['企业微信', '钉钉'])

const channelSettingSchema = z.object({
  enabled: z.boolean().optional().default(false),
  webhookUrl: z.string().trim().url().optional().or(z.literal('')),
  receivers: z.string().trim().max(200).optional().or(z.literal('')),
  keyword: z.string().trim().max(100).optional().or(z.literal('')),
})

const outboundNotificationSettingsSchema = z.object({
  inApp: z.object({ enabled: z.boolean() }),
  dingTalk: channelSettingSchema,
  weCom: channelSettingSchema,
}).superRefine((value, context) => {
  for (const [key, label] of [['dingTalk', '钉钉'], ['weCom', '企业微信']] as const) {
    if (value[key].enabled && !value[key].webhookUrl?.trim()) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: [key, 'webhookUrl'], message: `启用${label}时必须填写 Webhook URL` })
    }
  }
})

const tradingTimeRangeSchema = z.object({
  start: z.string().regex(/^\d{2}:\d{2}$/),
  end: z.string().regex(/^\d{2}:\d{2}$/),
})
const tradingMarketSchema = z.object({
  key: z.enum(['CN_INTERNAL', 'GLOBAL_EXTERNAL', 'ALWAYS_ON']),
  label: z.string().trim().min(1).max(40),
  weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1).max(7),
  sessions: z.array(tradingTimeRangeSchema).min(1).max(8),
})
const dashboardTradingSessionSettingsSchema = z.object({
  timezone: z.string().trim().min(1).max(80),
  windowDays: z.coerce.number().int().min(1).max(30),
  markets: z.array(tradingMarketSchema).min(1).max(3),
})

const testSchema = z.object({
  channel: outboundChannelSchema,
  webhookUrl: z.string().trim().url().optional().or(z.literal('')),
  keyword: z.string().trim().max(100).optional().or(z.literal('')),
  content: z.string().trim().max(1000).optional(),
})

const router = Router()
router.use(authenticate)

router.get('/outbound-notifications', requirePermission(PERMISSIONS.SETTINGS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getOutboundNotificationSettings() })
  } catch (error) {
    next(error)
  }
})

router.put('/outbound-notifications', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res, next) => {
  try {
    const values = outboundNotificationSettingsSchema.parse(req.body)
    res.json({ data: await saveOutboundNotificationSettings(values) })
  } catch (error) {
    next(error)
  }
})

router.get('/dashboard-trading-sessions', requirePermission(PERMISSIONS.SETTINGS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getDashboardTradingSessionSettings() })
  } catch (error) {
    next(error)
  }
})

router.put('/dashboard-trading-sessions', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res, next) => {
  try {
    const values = dashboardTradingSessionSettingsSchema.parse(req.body)
    res.json({ data: await saveDashboardTradingSessionSettings(values) })
  } catch (error) {
    next(error)
  }
})

router.post('/outbound-notifications/test', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res, next) => {
  try {
    const values = testSchema.parse(req.body)
    const settings = await getOutboundNotificationSettings()
    const savedUrl = values.channel === '钉钉' ? settings.dingTalk.webhookUrl : settings.weCom.webhookUrl
    const webhookUrl = values.webhookUrl?.trim() || savedUrl || ''
    const content = values.content || `【告警通知测试】运维平台正在测试${values.channel}机器人消息，请确认可以收到。`
    res.json({ data: { results: await sendNotificationTest({ channel: values.channel, webhookUrl, keyword: values.keyword, content }) } })
  } catch (error) {
    next(error)
  }
})

export default router
