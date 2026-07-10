export interface HostServiceItem {
  id: string
  hostId: string
  name: string
  status: string
  port?: number
  protocol?: string
  version?: string
  pid?: number
  source: string
  metadata?: unknown
  lastReportedAt: string
}

export interface ServiceEventItem {
  id: string
  hostId: string
  service: string
  eventType: string
  level: string
  message: string
  occurredAt: string
  source: string
  payload?: unknown
}
