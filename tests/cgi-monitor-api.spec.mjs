import assert from 'node:assert/strict'
import http from 'node:http'
import { prisma } from '../server/db/prisma.ts'
import { createCgiMonitorRule, deleteCgiMonitorRule, evaluateCgiMonitorRule, listCgiMonitorAlerts } from '../server/data/cgiMonitorRules.ts'

let body = 'OK 400 ready'
const server = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' })
  res.end(body)
})

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => resolve(server.address()))
  })
}

const address = await listen(server)
const url = `http://127.0.0.1:${address.port}/cgi/status`
let rule

try {
  rule = await createCgiMonitorRule({
    name: `cgi-monitor-smoke-${Date.now()}`,
    description: 'CGI monitor smoke test',
    url,
    method: 'GET',
    keyword: '400',
    matchMode: 'contains',
    expectedStatus: 200,
    timeoutMs: 3000,
    intervalSeconds: 10,
    failureThreshold: 1,
    cooldownMinutes: 1,
    alertLevel: '警告',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    timeRanges: [{ start: '00:00', end: '23:59' }],
    holidayMode: 'ignore',
    notification: { channels: ['站内告警'], receivers: 'cgi-monitor-test' },
  })

  const okResult = await evaluateCgiMonitorRule(rule, new Date(), { force: true })
  assert.equal(okResult.checked, true, 'first evaluation should run')
  assert.equal(okResult.ok, true, 'response containing keyword should be healthy')
  assert.equal(okResult.triggered, false, 'healthy response should not trigger alert')
  assert.equal(okResult.matched, true, 'keyword should be detected')

  body = 'OK ready without expected token'
  const refreshed = await prisma.cgiMonitorRule.findUniqueOrThrow({ where: { id: rule.id } })
  const failResult = await evaluateCgiMonitorRule({
    ...rule,
    lastCheckedAt: refreshed.lastCheckedAt?.toISOString(),
    consecutiveFailures: refreshed.consecutiveFailures,
    triggerCount: refreshed.triggerCount,
  }, new Date(), { force: true })
  assert.equal(failResult.checked, true, 'second evaluation should run')
  assert.equal(failResult.ok, false, 'missing keyword should be unhealthy')
  assert.equal(failResult.triggered, true, 'missing keyword should trigger at threshold 1')
  assert.match(failResult.errorMessage || '', /未包含关键字/)

  const stored = await prisma.cgiMonitorRule.findUniqueOrThrow({ where: { id: rule.id } })
  assert.equal(stored.consecutiveFailures, 1, 'consecutive failures should increment')
  assert.equal(stored.triggerCount, 1, 'trigger count should increment')
  assert.equal(stored.lastStatusCode, 200, 'last HTTP status should be recorded')

  const alerts = await listCgiMonitorAlerts(rule.id)
  assert.equal(alerts.length, 1, 'CGI monitor alert record should be created')
  assert.equal(alerts[0].matched, false, 'alert record should capture missing keyword')

  const centerAlert = await prisma.alert.findUniqueOrThrow({ where: { id: alerts[0].alertId } })
  assert.equal(centerAlert.source, 'CGI监控', 'central alert should use CGI monitor source')
  assert.equal(centerAlert.relatedType, 'cgi_monitor_rule')

  console.log('cgi-monitor-api-ok')
} finally {
  if (rule) {
    await prisma.cgiMonitorAlert.deleteMany({ where: { ruleId: rule.id } })
    await prisma.alert.deleteMany({ where: { relatedType: 'cgi_monitor_rule', relatedId: rule.id } })
    await deleteCgiMonitorRule(rule.id).catch(() => undefined)
  }
  await prisma.$disconnect()
  server.close()
}
