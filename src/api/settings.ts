import type { OutboundNotificationSettings, OutboundNotificationTestResult } from '../types/settings'
import { http } from './http'

export async function getOutboundNotificationSettings(): Promise<OutboundNotificationSettings> {
  const response = await http.get<{ data: OutboundNotificationSettings }>('/settings/outbound-notifications')
  return response.data.data
}

export async function saveOutboundNotificationSettings(values: OutboundNotificationSettings): Promise<OutboundNotificationSettings> {
  const response = await http.put<{ data: OutboundNotificationSettings }>('/settings/outbound-notifications', values)
  return response.data.data
}

export async function testOutboundNotification(values: { channel: '企业微信' | '钉钉'; webhookUrl?: string; content?: string }): Promise<OutboundNotificationTestResult> {
  const response = await http.post<{ data: OutboundNotificationTestResult }>('/settings/outbound-notifications/test', values)
  return response.data.data
}
