import type { NotificationItem } from '../types/notification'
import { http } from './http'

export async function listNotifications(filters: { unreadOnly?: boolean; limit?: number } = {}): Promise<NotificationItem[]> {
  const response = await http.get<{ data: NotificationItem[] }>('/notifications', { params: filters })
  return response.data.data
}

export async function getUnreadNotificationCount(): Promise<number> {
  const response = await http.get<{ data: { count: number } }>('/notifications/unread-count')
  return response.data.data.count
}

export async function markNotificationRead(id: string): Promise<NotificationItem> {
  const response = await http.patch<{ data: NotificationItem }>(`/notifications/${id}/read`)
  return response.data.data
}

export async function markAllNotificationsRead(): Promise<{ count: number }> {
  const response = await http.patch<{ data: { count: number } }>('/notifications/read-all')
  return response.data.data
}
