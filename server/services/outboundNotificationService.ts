import { getOutboundNotificationSettings, type OutboundNotificationChannel } from '../data/settings'

export interface SendMonitorNotificationsInput {
  content: string
  timeoutMs?: number
}

export interface SendNotificationTestInput {
  channel: Exclude<OutboundNotificationChannel, '站内告警'>
  webhookUrl: string
  content: string
  keyword?: string
  timeoutMs?: number
}

type WebhookDestination = 'global' | 'test'

function compact(value: string, maxLength = 500) {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength)
}

function providerResult(body: string) {
  if (!body) return {}
  try {
    const data = JSON.parse(body) as { errcode?: unknown; errmsg?: unknown; code?: unknown; message?: unknown }
    const errcode = data.errcode ?? data.code
    const errmsg = data.errmsg ?? data.message
    return {
      errcode: errcode === undefined ? undefined : String(errcode),
      errmsg: errmsg === undefined ? undefined : String(errmsg),
    }
  } catch {
    return { raw: compact(body) }
  }
}

function isProviderOk(statusOk: boolean, result: ReturnType<typeof providerResult>) {
  if (!statusOk) return false
  if (result.errcode === undefined) return true
  return result.errcode === '0'
}

function formatResult(channel: OutboundNotificationChannel, destination: WebhookDestination, response: Response, body: string) {
  const parsed = providerResult(body)
  const ok = isProviderOk(response.ok, parsed)
  const parts = [`${destination}`, `HTTP ${response.status}`]
  if (parsed.errcode !== undefined) parts.push(`errcode=${parsed.errcode}`)
  if (parsed.errmsg) parts.push(`errmsg=${compact(parsed.errmsg, 180)}`)
  if (!parsed.errmsg && parsed.raw) parts.push(`body=${parsed.raw}`)
  return `${channel} ${ok ? '发送成功' : '发送失败'}（${parts.join('，')}）`
}

async function postWebhook(channel: OutboundNotificationChannel, webhookUrl: string, content: string, destination: WebhookDestination, timeoutMs: number) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msgtype: 'text', text: { content } }),
      signal: controller.signal,
    })
    const body = await response.text().catch(() => '')
    return formatResult(channel, destination, response, body)
  } catch (error) {
    const message = error instanceof Error && error.name === 'AbortError' ? `请求超时（${timeoutMs}ms）` : error instanceof Error ? error.message : String(error)
    return `${channel} 发送失败：${message}`
  } finally {
    clearTimeout(timer)
  }
}

export async function sendMonitorNotifications(input: SendMonitorNotificationsInput) {
  const settings = await getOutboundNotificationSettings()
  const channels: Array<{ channel: Exclude<OutboundNotificationChannel, '站内告警'>; enabled: boolean; webhookUrl?: string; keyword?: string }> = [
    { channel: '企业微信', ...settings.weCom },
    { channel: '钉钉', ...settings.dingTalk },
  ]

  const results: string[] = []
  for (const item of channels) {
    if (!item.enabled) continue
    const webhookUrl = item.webhookUrl?.trim()
    if (!webhookUrl) {
      results.push(`${item.channel} 未配置 Webhook`)
      continue
    }
    const content = item.keyword?.trim() ? `${item.keyword.trim()}\n${input.content}` : input.content
    results.push(await postWebhook(item.channel, webhookUrl, content, 'global', input.timeoutMs ?? 10000))
  }
  return results
}

export async function sendNotificationTest(input: SendNotificationTestInput) {
  if (!input.webhookUrl.trim()) return [`${input.channel} 未配置 Webhook`]
  const content = input.keyword?.trim() ? `${input.keyword.trim()}\n${input.content}` : input.content
  return [await postWebhook(input.channel, input.webhookUrl.trim(), content, 'test', input.timeoutMs ?? 10000)]
}
