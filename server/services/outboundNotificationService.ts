import { getGlobalWebhookForChannel, type OutboundNotificationChannel } from '../data/settings'

export interface RuleNotificationConfig {
  channels: OutboundNotificationChannel[]
  webhookUrl?: string
}

export interface SendMonitorNotificationsInput {
  ruleNotification: RuleNotificationConfig
  content: string
  timeoutMs?: number
}

export interface SendNotificationTestInput {
  channel: Exclude<OutboundNotificationChannel, '站内告警'>
  webhookUrl: string
  content: string
  timeoutMs?: number
}

type WebhookDestination = 'rule' | 'global' | 'test'

const outboundChannels = new Set<OutboundNotificationChannel>(['企业微信', '钉钉'])

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

async function resolveWebhook(channel: OutboundNotificationChannel, ruleWebhookUrl?: string) {
  const overrideUrl = ruleWebhookUrl?.trim()
  if (overrideUrl) return { url: overrideUrl, destination: 'rule' as const }
  const globalUrl = await getGlobalWebhookForChannel(channel)
  if (globalUrl) return { url: globalUrl, destination: 'global' as const }
  return undefined
}

export async function sendMonitorNotifications(input: SendMonitorNotificationsInput) {
  const channels = input.ruleNotification.channels.filter((channel) => outboundChannels.has(channel))
  if (!channels.length) return []

  const results: string[] = []
  for (const channel of channels) {
    const resolved = await resolveWebhook(channel, input.ruleNotification.webhookUrl)
    if (!resolved) {
      results.push(`${channel} 未配置 Webhook`)
      continue
    }
    results.push(await postWebhook(channel, resolved.url, input.content, resolved.destination, input.timeoutMs ?? 10000))
  }
  return results
}

export async function sendNotificationTest(input: SendNotificationTestInput) {
  if (!input.webhookUrl.trim()) return [`${input.channel} 未配置 Webhook`]
  return [await postWebhook(input.channel, input.webhookUrl.trim(), input.content, 'test', input.timeoutMs ?? 10000)]
}
