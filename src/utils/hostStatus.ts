import type { Host, HostCategory } from '../types/host'

export const hostCategoryColor = { 在线: 'green', 离线: 'red', 维护: 'orange' } satisfies Record<HostCategory, string>

export function getHostCategory(host: Host): HostCategory {
  if (host.maintenance.active) return '维护'
  return host.status === '在线' ? '在线' : '离线'
}
