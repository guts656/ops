import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { createLogMonitorRule, deleteLogMonitorRule, ensureDefaultErrorLogMonitorRule, evaluateLogMonitorRule } from '../server/data/logMonitorRules.ts'

const now = Date.now()
const group = `log-monitor-scope-${now}`
const otherGroup = `log-monitor-other-${now}`
const hosts = [
  { id: `log-monitor-host-a-${now}`, ip: `10.252.${now % 200}.1`, hostname: `log-monitor-a-${now}`, group },
  { id: `log-monitor-host-b-${now}`, ip: `10.252.${now % 200}.2`, hostname: `log-monitor-b-${now}`, group },
  { id: `log-monitor-host-c-${now}`, ip: `10.252.${now % 200}.3`, hostname: `log-monitor-c-${now}`, group: otherGroup },
]
const servicePrefix = `log-monitor-scope-${now}`
const ruleIds = []

function hostData(host, overrides = {}) {
  return {
    id: host.id,
    ip: host.ip,
    hostname: host.hostname,
    os: 'Linux',
    osVersion: 'Smoke Linux',
    cpu: 0,
    memory: 0,
    disk: 0,
    status: '在线',
    group: host.group,
    tags: ['smoke'],
    agentVersion: 'smoke',
    agentStatus: '正常',
    agentInstalledAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    lastHeartbeat: new Date().toLocaleString('zh-CN', { hour12: false }),
    sshPort: 22,
    owner: 'smoke',
    changeNo: 'SMOKE',
    ...overrides,
  }
}

async function cleanup() {
  await prisma.logMonitorAlert.deleteMany({ where: { ruleId: { in: ruleIds } } })
  await prisma.alert.deleteMany({ where: { relatedType: 'log_monitor_rule', relatedId: { in: ruleIds } } })
  await prisma.logMonitorRule.deleteMany({ where: { id: { in: ruleIds } } })
  await prisma.appLog.deleteMany({ where: { service: { startsWith: servicePrefix } } })
  await prisma.host.deleteMany({ where: { id: { in: hosts.map((host) => host.id) } } })
}

function log({ hostId, service, message, offset = 0, level = 'ERROR' }) {
  const timestamp = new Date(now + offset)
  return {
    id: `${service}-${hostId}-${offset}`,
    time: timestamp.toISOString(),
    timestamp,
    service,
    level,
    traceId: `${service}:${hostId}:${offset}`,
    message,
    hostId,
    source: 'smoke',
  }
}

async function createRule(input) {
  const rule = await createLogMonitorRule({
    name: `${input.service}-rule`,
    description: 'log monitor scope smoke test',
    service: input.service,
    keywords: [input.keyword],
    threshold: 1,
    windowMinutes: 60,
    cooldownMinutes: 1,
    alertLevel: '警告',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    timeRanges: [{ start: '00:00', end: '23:59' }],
    holidayMode: 'ignore',
    notification: { channels: ['站内告警'], receivers: 'log-monitor-test' },
    ...input.scope,
  })
  ruleIds.push(rule.id)
  return rule
}

try {
  await cleanup()
  await prisma.host.createMany({ data: hosts.map((host) => hostData(host)) })

  const legacyService = `${servicePrefix}-legacy`
  const legacyRule = await createRule({ service: legacyService, keyword: 'LEGACY_SCOPE', scope: { hostId: hosts[0].id } })
  assert.equal(legacyRule.hostScope, 'single', 'legacy hostId should normalize to single scope')
  assert.deepEqual(legacyRule.hostIds, [hosts[0].id], 'legacy hostId should be mirrored into hostIds')

  const multipleService = `${servicePrefix}-multiple`
  await prisma.appLog.createMany({
    data: [
      log({ hostId: hosts[0].id, service: multipleService, message: 'MULTI_SCOPE host a', offset: 1 }),
      log({ hostId: hosts[1].id, service: multipleService, message: 'MULTI_SCOPE host b', offset: 2 }),
      log({ hostId: hosts[2].id, service: multipleService, message: 'MULTI_SCOPE host c should not count', offset: 3 }),
    ],
  })
  const multipleRule = await createRule({ service: multipleService, keyword: 'MULTI_SCOPE', scope: { hostScope: 'multiple', hostIds: [hosts[0].id, hosts[1].id, hosts[0].id] } })
  assert.equal(multipleRule.hostScope, 'multiple')
  assert.deepEqual(multipleRule.hostIds.sort(), [hosts[0].id, hosts[1].id].sort(), 'multiple host ids should be deduplicated')
  assert.equal(multipleRule.hostId, undefined, 'multiple scope should not persist legacy hostId')
  const multipleResult = await evaluateLogMonitorRule(multipleRule, new Date(now + 10_000))
  assert.equal(multipleResult.matchedCount, 2, 'multiple scope should count only selected hosts')
  assert.equal(multipleResult.triggered, true, 'multiple scope should trigger when threshold is met')

  const groupService = `${servicePrefix}-group`
  await prisma.appLog.createMany({
    data: [
      log({ hostId: hosts[0].id, service: groupService, message: 'GROUP_SCOPE host a', offset: 11 }),
      log({ hostId: hosts[1].id, service: groupService, message: 'GROUP_SCOPE host b', offset: 12 }),
      log({ hostId: hosts[2].id, service: groupService, message: 'GROUP_SCOPE host c should not count', offset: 13 }),
    ],
  })
  const groupRule = await createRule({ service: groupService, keyword: 'GROUP_SCOPE', scope: { hostScope: 'group', hostGroup: group } })
  const groupResult = await evaluateLogMonitorRule(groupRule, new Date(now + 20_000))
  assert.equal(groupResult.matchedCount, 2, 'group scope should count only hosts in the selected group')
  assert.equal(groupResult.triggered, true, 'group scope should trigger when threshold is met')

  const allService = `${servicePrefix}-all`
  await prisma.appLog.createMany({
    data: [
      log({ hostId: hosts[0].id, service: allService, message: 'ALL_SCOPE host a', offset: 21 }),
      log({ hostId: hosts[2].id, service: allService, message: 'ALL_SCOPE host c', offset: 22 }),
    ],
  })
  const allRule = await createRule({ service: allService, keyword: 'ALL_SCOPE', scope: { hostScope: 'all' } })
  const allResult = await evaluateLogMonitorRule(allRule, new Date(now + 30_000))
  assert.equal(allResult.matchedCount, 2, 'all scope should not restrict by host')
  assert.equal(allResult.triggered, true, 'all scope should trigger when threshold is met')

  const levelOnlyService = `${servicePrefix}-level-only`
  await prisma.appLog.createMany({
    data: [
      log({ hostId: hosts[0].id, service: levelOnlyService, message: 'fatal panic without literal keyword', offset: 24, level: 'ERROR' }),
      log({ hostId: hosts[1].id, service: levelOnlyService, message: 'warning should not match level only rule', offset: 25, level: 'WARN' }),
    ],
  })
  const levelOnlyRule = await createLogMonitorRule({
    name: `${levelOnlyService}-rule`,
    description: 'level only ERROR rule smoke test',
    service: levelOnlyService,
    level: 'ERROR',
    keywords: [],
    threshold: 1,
    windowMinutes: 60,
    cooldownMinutes: 1,
    alertLevel: '严重',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    timeRanges: [{ start: '00:00', end: '23:59' }],
    holidayMode: 'ignore',
    notification: { channels: ['站内告警'], receivers: 'log-monitor-test' },
    hostScope: 'all',
  })
  ruleIds.push(levelOnlyRule.id)
  const levelOnlyResult = await evaluateLogMonitorRule(levelOnlyRule, new Date(now + 35_000))
  assert.equal(levelOnlyResult.matchedCount, 1, 'level-only ERROR rule should match ERROR logs without literal ERROR text')
  assert.equal(levelOnlyResult.triggered, true, 'level-only ERROR rule should trigger alert center alert')
  assert.deepEqual(levelOnlyResult.matchedKeywords, [], 'level-only rule should not report fake matched keywords')
  const levelOnlyAlert = await prisma.alert.findFirst({ where: { relatedType: 'log_monitor_rule', relatedId: levelOnlyRule.id } })
  assert.ok(levelOnlyAlert, 'level-only rule should create alert center record')
  assert.equal(levelOnlyAlert.source, '日志监控')
  assert.match(levelOnlyAlert.content, /日志级别「ERROR」/)
  assert.doesNotMatch(levelOnlyAlert.content, /日志关键字「」/)

  const defaultRule = await ensureDefaultErrorLogMonitorRule()
  ruleIds.push(defaultRule.id)
  assert.equal(defaultRule.id, 'builtin-error-log-alerts')
  assert.equal(defaultRule.level, 'ERROR')
  assert.deepEqual(defaultRule.keywords, [])
  assert.equal(defaultRule.threshold, 1)
  assert.equal(defaultRule.alertLevel, '严重')

  await prisma.host.update({ where: { id: hosts[0].id }, data: { maintenanceEnabled: true, maintenanceReason: 'smoke', maintenanceUntil: new Date(now + 3_600_000), maintenanceStartedAt: new Date(now) } })
  const maintenanceService = `${servicePrefix}-maintenance`
  await prisma.appLog.create({ data: log({ hostId: hosts[0].id, service: maintenanceService, message: 'MAINT_SCOPE host a', offset: 31 }) })
  const maintenanceRule = await createRule({ service: maintenanceService, keyword: 'MAINT_SCOPE', scope: { hostScope: 'multiple', hostIds: [hosts[0].id] } })
  const maintenanceResult = await evaluateLogMonitorRule(maintenanceRule, new Date(now + 40_000))
  assert.equal(maintenanceResult.triggered, false, 'maintenance source host should suppress alert')
  assert.match(maintenanceResult.skippedReason || '', /维护中/)

  console.log('log-monitor-api-ok')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
