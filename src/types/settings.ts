import type { CgiMonitorChannel } from './cgiMonitor'

export interface OutboundChannelSetting {
  enabled: boolean
  webhookUrl?: string
  receivers?: string
}

export interface OutboundNotificationSettings {
  defaultChannels: CgiMonitorChannel[]
  dingTalk: OutboundChannelSetting
  weCom: OutboundChannelSetting
}

export interface OutboundNotificationTestResult {
  results: string[]
}
