import { create } from 'zustand'
import { getUnreadNotificationCount, listNotifications, markAllNotificationsRead, markNotificationRead } from '../api/notifications'

export const useNotificationStore = create((set, get) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  async load(filters = {}) {
    set({ loading: true })
    try {
      const [notifications, unreadCount] = await Promise.all([listNotifications({ limit: 50, ...filters }), getUnreadNotificationCount()])
      set({ notifications, unreadCount })
    } finally {
      set({ loading: false })
    }
  },
  async loadUnreadCount() {
    const unreadCount = await getUnreadNotificationCount()
    set({ unreadCount })
  },
  async markRead(id) {
    const updated = await markNotificationRead(id)
    set((state) => ({
      notifications: state.notifications.map((item) => (item.id === id ? updated : item)),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }))
  },
  async markAllRead() {
    await markAllNotificationsRead()
    set((state) => ({ notifications: state.notifications.map((item) => ({ ...item, readAt: item.readAt || new Date().toISOString() })), unreadCount: 0 }))
  },
  prepend(notification) {
    set((state) => ({
      notifications: [notification, ...state.notifications].slice(0, 50),
      unreadCount: state.unreadCount + (notification.readAt ? 0 : 1),
    }))
  },
  refreshFromRealtime() {
    void get().load()
  },
}))
