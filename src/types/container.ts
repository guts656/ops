export interface HostContainerItem {
  id: string
  hostId: string
  containerId: string
  name: string
  image: string
  status: string
  state: string
  restartCount: number
  ports?: unknown
  cpuPercent?: number
  memoryUsageBytes?: string
  memoryLimitBytes?: string
  memoryPercent?: number
  networkRxBytes?: string
  networkTxBytes?: string
  blockReadBytes?: string
  blockWriteBytes?: string
  labels?: unknown
  startedAt?: string
  lastReportedAt: string
  isCurrent?: boolean
  logicalKey?: string
  retiredAt?: string
  retiredReason?: string
}
