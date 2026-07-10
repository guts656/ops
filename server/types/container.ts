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

export interface AgentContainerInput {
  containerId: string
  name: string
  image: string
  status: string
  state: string
  restartCount?: number | null
  ports?: unknown
  cpuPercent?: number | null
  memoryUsageBytes?: string | number | null
  memoryLimitBytes?: string | number | null
  memoryPercent?: number | null
  networkRxBytes?: string | number | null
  networkTxBytes?: string | number | null
  blockReadBytes?: string | number | null
  blockWriteBytes?: string | number | null
  labels?: unknown
  startedAt?: string | null
  lastReportedAt?: string | null
}
