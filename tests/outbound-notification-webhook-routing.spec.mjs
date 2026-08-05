import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8')

const [
  settingsData,
  settingsRoute,
  selfHealingRoute,
  notificationService,
  alertIngestionService,
  hostResourceRoute,
  logRoute,
  cgiRoute,
  sslRoute,
  hostResourcePanel,
  logMonitoringPage,
  cgiPanel,
  sslPage,
] = await Promise.all([
  read('../server/data/settings.ts'),
  read('../server/routes/settings.ts'),
  read('../server/routes/selfHealing.ts'),
  read('../server/services/outboundNotificationService.ts'),
  read('../server/services/alertIngestionService.ts'),
  read('../server/routes/hostResourceMonitors.ts'),
  read('../server/routes/logs.ts'),
  read('../server/routes/cgiMonitors.ts'),
  read('../server/routes/sslCertificates.ts'),
  read('../src/components/log-monitoring/HostResourceMonitorPanel.tsx'),
  read('../src/pages/LogMonitoring.tsx'),
  read('../src/components/log-monitoring/CgiMonitorPanel.tsx'),
  read('../src/pages/SslCertificateMonitor.tsx'),
])

assert.match(settingsData, /inApp:\s*InAppNotificationSetting/)
assert.match(settingsData, /migrateLegacyRuleWebhooks/)
assert.match(settingsData, /candidates\[provider\]\.size !== 1/)
assert.match(settingsRoute, /inApp:\s*z\.object\(\{ enabled: z\.boolean\(\) \}\)/)
assert.match(settingsRoute, /启用.*时必须填写 Webhook URL/)
assert.doesNotMatch(selfHealingRoute, /channels:\s*z\.array/)
assert.match(notificationService, /getOutboundNotificationSettings\(\)/)
assert.match(notificationService, /if \(!item\.enabled\) continue/)
assert.match(notificationService, /item\.keyword\?\.trim\(\)/)
assert.match(alertIngestionService, /if \(settings\.inApp\.enabled\)/)
assert.doesNotMatch(notificationService, /ruleNotification|shouldUseRuleWebhook|outboundWebhookProvider/)
assert.doesNotMatch(alertIngestionService, /input\.outboundNotification|outboundNotification\s*:/)

for (const route of [hostResourceRoute, logRoute, cgiRoute, sslRoute]) {
  assert.doesNotMatch(route, /channels:\s*z\./)
  assert.doesNotMatch(route, /webhookUrl:\s*z\./)
}

for (const page of [hostResourcePanel, logMonitoringPage, cgiPanel, sslPage]) {
  assert.doesNotMatch(page, /通知渠道|规则 Webhook|Webhook 覆盖/)
}

console.log('global-notification-settings-only-ok')
