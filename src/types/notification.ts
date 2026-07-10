export type NotificationType = 'alert' | 'self_healing' | 'webhook' | 'system'
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export interface NotificationItem {
  id: string
  type: NotificationType
  level: NotificationLevel
  title: string
  content: string
  entityType?: string
  entityId?: string
  readAt?: string
  metadata: Record<string, unknown>
  createdAt: string
  updatedAt: string
}
