import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { evaluateHostOfflineWatchdog } from '../server/services/hostOfflineWatchdog.ts'

const now = Date.now()
const staleHostId = `host-offline-stale-${now}`
const freshHostId = `host-offline-fresh-${now}`
const maintenanceHostId = `host-offline-maintenance-${now}`

function textTime(date) {
  return date.toLocaleString('zh-CN', { hour12: false })
}

function hostData(id, offsetMinutes, extra = {}) {
  const heartbeat = new Date(Date.now() - offsetMinutes * 60_000)
  return {
    id,
    ip: `10.249.${Math.abs(offsetMinutes) % 200}.${Math.abs(id.split('').reduce((sum, char) => sum + char.charCodeAt(0), 0)) % 250}`,
    hostname: id,
    os: 'Windows',
    osVersion: 'Smoke Windows',
    cpu: 0,
    memory: 0,
    disk: 0,
    status: '在线',
    group: '测试资源池',
    tags: ['smoke'],
    agentVersion: 'smoke',
    agentStatus: '正常',
    agentInstalledAt: textTime(new Date(Date.now() - 60 * 60_000)),
    lastHeartbeat: textTime(heartbeat),
    lastMetricAt: heartbeat,
    createdAt: new Date(Date.now() - 60 * 60_000),
    sshPort: 5985,
    owner: 'smoke',
    changeNo: 'SMOKE',
    ...extra,
  }
}

async function cleanup() {
  await prisma.alert.deleteMany({ where: { fingerprint: { in: [`host-offline:${staleHostId}`, `host-offline:${freshHostId}`, `host-offline:${maintenanceHostId}`] } } })
  await prisma.alertNoiseRecord.deleteMany({ where: { fingerprint: { in: [`host-offline:${staleHostId}`, `host-offline:${freshHostId}`, `host-offline:${maintenanceHostId}`] } } })
  await prisma.host.deleteMany({ where: { id: { in: [staleHostId, freshHostId, maintenanceHostId] } } })
}

try {
  process.env.HOST_OFFLINE_WATCHDOG_ENABLED = 'true'
  await cleanup()
  await prisma.host.createMany({ data: [
    hostData(staleHostId, 30),
    hostData(freshHostId, 1),
    hostData(maintenanceHostId, 30, { maintenanceEnabled: true, maintenanceReason: 'smoke maintenance' }),
  ] })

  const first = await evaluateHostOfflineWatchdog(new Date(), { hostIds: [staleHostId, freshHostId, maintenanceHostId] })
  assert.equal(first.checked, 3, 'watchdog should inspect managed hosts')
  assert.ok(await prisma.alert.findFirst({ where: { fingerprint: `host-offline:${staleHostId}`, source: 'Agent在线监控', status: { not: '已解决' } } }), 'stale host should create offline alert')
  assert.equal(await prisma.alert.count({ where: { fingerprint: `host-offline:${freshHostId}` } }), 0, 'fresh host should not create offline alert')
  assert.equal(await prisma.alert.count({ where: { fingerprint: `host-offline:${maintenanceHostId}` } }), 0, 'maintenance host should not create offline alert')

  await evaluateHostOfflineWatchdog(new Date(), { hostIds: [staleHostId, freshHostId, maintenanceHostId] })
  assert.equal(await prisma.alert.count({ where: { fingerprint: `host-offline:${staleHostId}`, status: { not: '已解决' } } }), 1, 'repeated watchdog runs should not create multiple active offline alerts')

  await prisma.host.update({ where: { id: staleHostId }, data: { status: '在线', agentStatus: '正常', lastHeartbeat: textTime(new Date()), lastMetricAt: new Date() } })
  await evaluateHostOfflineWatchdog(new Date(), { hostIds: [staleHostId, freshHostId, maintenanceHostId] })
  const resolved = await prisma.alert.findFirstOrThrow({ where: { fingerprint: `host-offline:${staleHostId}` }, orderBy: { updatedAt: 'desc' } })
  assert.equal(resolved.status, '已解决', 'fresh heartbeat should resolve offline alert')
  assert.ok(resolved.metadata?.recovery, 'resolved offline alert should record recovery metadata')

  console.log('host-offline-watchdog-ok')
} finally {
  await cleanup()
  delete process.env.HOST_OFFLINE_WATCHDOG_ENABLED
  await prisma.$disconnect()
}
