export interface OutboundChannelSetting {
  enabled: boolean
  webhookUrl?: string
  receivers?: string
  keyword?: string
}

export interface OutboundNotificationSettings {
  inApp: { enabled: boolean }
  dingTalk: OutboundChannelSetting
  weCom: OutboundChannelSetting
}

export interface OutboundNotificationTestResult {
  results: string[]
}
