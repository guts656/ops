import { create } from 'zustand'

const storedCollapsed = localStorage.getItem('ops-platform.sidebar.collapsed') === 'true'

export const useAppStore = create((set) => ({
  collapsed: storedCollapsed,
  autoRefresh: true,
  toggleCollapsed: () =>
    set((state) => {
      const next = !state.collapsed
      localStorage.setItem('ops-platform.sidebar.collapsed', String(next))
      return { collapsed: next }
    }),
  setAutoRefresh: (autoRefresh) => set({ autoRefresh }),
}))
