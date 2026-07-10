import type { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma'
import { emitNotificationEvent } from './realtime'

export type NotificationType = 'alert' | 'self_healing' | 'webhook' | 'system'
export type NotificationLevel = 'info' | 'success' | 'warning' | 'error'

export interface NotificationInput {
  type: NotificationType
  level?: NotificationLevel
  title: string
  content: string
  entityType?: string
  entityId?: string
  metadata?: Record<string, unknown>
}

function toNotification(row: any) {
  return {
    id: row.id,
    type: row.type,
    level: row.level,
    title: row.title,
    content: row.content,
    entityType: row.entityType ?? undefined,
    entityId: row.entityId ?? undefined,
    readAt: row.readAt?.toISOString?.(),
    metadata: row.metadata && typeof row.metadata === 'object' && !Array.isArray(row.metadata) ? row.metadata : {},
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

export async function createNotification(input: NotificationInput) {
  const notification = await prisma.notification.create({
    data: {
      type: input.type,
      level: input.level ?? 'info',
      title: input.title,
      content: input.content,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  })
  const item = toNotification(notification)
  emitNotificationEvent(item)
  return item
}

export async function listNotifications(filters: { unreadOnly?: boolean; limit?: number } = {}) {
  const rows = await prisma.notification.findMany({
    where: { readAt: filters.unreadOnly ? null : undefined },
    orderBy: { createdAt: 'desc' },
    take: Math.min(Math.max(filters.limit ?? 50, 1), 100),
  })
  return rows.map(toNotification)
}

export async function getUnreadNotificationCount() {
  return prisma.notification.count({ where: { readAt: null } })
}

export async function markNotificationRead(id: string) {
  const row = await prisma.notification.update({ where: { id }, data: { readAt: new Date() } })
  return toNotification(row)
}

export async function markAllNotificationsRead() {
  const result = await prisma.notification.updateMany({ where: { readAt: null }, data: { readAt: new Date() } })
  return { count: result.count }
}
