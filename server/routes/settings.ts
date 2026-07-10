import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions.ts'
import { getOutboundNotificationSettings, saveOutboundNotificationSettings } from '../data/settings.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { requirePermission } from '../middleware/requirePermission.ts'
import { sendNotificationTest } from '../services/outboundNotificationService.ts'

const channelSchema = z.enum(['站内告警', '企业微信', '钉钉'])
const outboundChannelSchema = z.enum(['企业微信', '钉钉'])

const channelSettingSchema = z.object({
  enabled: z.boolean().optional().default(false),
  webhookUrl: z.string().trim().url().optional().or(z.literal('')),
  receivers: z.string().trim().max(200).optional().or(z.literal('')),
})

const outboundNotificationSettingsSchema = z.object({
  defaultChannels: z.array(channelSchema).min(1).max(3),
  dingTalk: channelSettingSchema,
  weCom: channelSettingSchema,
})

const testSchema = z.object({
  channel: outboundChannelSchema,
  webhookUrl: z.string().trim().url().optional().or(z.literal('')),
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

router.post('/outbound-notifications/test', requirePermission(PERMISSIONS.SETTINGS_MANAGE), async (req, res, next) => {
  try {
    const values = testSchema.parse(req.body)
    const settings = await getOutboundNotificationSettings()
    const savedUrl = values.channel === '钉钉' ? settings.dingTalk.webhookUrl : settings.weCom.webhookUrl
    const webhookUrl = values.webhookUrl?.trim() || savedUrl || ''
    const content = values.content || `【告警通知测试】运维平台正在测试${values.channel}机器人消息，请确认可以收到。`
    res.json({ data: { results: await sendNotificationTest({ channel: values.channel, webhookUrl, content }) } })
  } catch (error) {
    next(error)
  }
})

export default router
