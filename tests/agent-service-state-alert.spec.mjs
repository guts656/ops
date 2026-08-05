import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { getHostServices, ingestHostServices, ingestServiceEvents } from '../server/data/hostServices.ts'
import { getDashboardData } from '../server/data/dashboard.ts'

const now = Date.now()
const windowsHostId = `host-service-state-win-${now}`
const linuxHostId = `host-service-state-linux-${now}`
const serviceName = `demo-${now}.service`
const otherService = `other-${now}.service`
const eventOnlyService = `event-only-${now}.service`
const linuxService = `linux-${now}.service`
const hiddenService = `baseline-stopped-${now}.service`
const legacyMissingService = `legacy-missing-${now}.service`
const fingerprint = `agent-service:${windowsHostId}:${serviceName}:0:abnormal`

function hostData(id, os) {
  return {
    id,
    ip: os === 'Windows' ? `10.253.${now % 200}.${now % 250}` : `10.252.${now % 200}.${now % 250}`,
    hostname: `${os.toLowerCase()}-service-state-${now}`,
    os,
    osVersion: `Smoke ${os}`,
    cpu: 0,
    memory: 0,
    disk: 0,
    status: '在线',
    group: '测试资源池',
    tags: ['smoke'],
    agentVersion: 'smoke',
    agentStatus: '正常',
    agentInstalledAt: new Date().toLocaleString('zh-CN', { hour12: false }),
    lastHeartbeat: new Date().toLocaleString('zh-CN', { hour12: false }),
    sshPort: os === 'Windows' ? 5985 : 22,
    owner: 'smoke',
    changeNo: 'SMOKE',
  }
}

async function cleanup() {
  await prisma.alert.deleteMany({ where: { OR: [{ service: { in: [serviceName, otherService, eventOnlyService, linuxService, hiddenService, legacyMissingService] } }, { fingerprint: { startsWith: `agent-service:${linuxHostId}:` } }, { fingerprint }] } })
  await prisma.alertNoiseRecord.deleteMany({ where: { OR: [{ fingerprint }, { fingerprint: { startsWith: `agent-service:${linuxHostId}:` } }, { fingerprint: `agent-service:${windowsHostId}:${eventOnlyService}:0:abnormal` }] } })
  await prisma.host.deleteMany({ where: { id: { in: [windowsHostId, linuxHostId] } } })
}

try {
  await cleanup()
  await prisma.host.createMany({ data: [hostData(windowsHostId, 'Windows'), hostData(linuxHostId, 'Linux')] })

  const windowsService = (name, status) => ({ name, status, source: 'windows-service', metadata: { path: 'C:\\Apps\\Demo\\demo.exe' }, lastReportedAt: new Date().toISOString() })

  await ingestHostServices(windowsHostId, [windowsService(hiddenService, 'stopped')])
  const hidden = await prisma.hostService.findFirstOrThrow({ where: { hostId: windowsHostId, name: hiddenService } })
  assert.equal(hidden.status, 'stopped', 'initially stopped Windows service should be stored as baseline memory')
  assert.equal(hidden.metadata?.hiddenStoppedBaseline, true, 'initially stopped Windows service should be marked hidden baseline')
  assert.equal(hidden.metadata?.everHealthy, false, 'initially stopped Windows service should not be marked ever healthy')
  assert.equal((await getHostServices(windowsHostId)).some((service) => service.name === hiddenService), false, 'hidden baseline should not appear in host service list')
  assert.equal(await prisma.serviceEvent.count({ where: { hostId: windowsHostId, service: hiddenService } }), 0, 'hidden baseline should not create events')
  assert.equal(await prisma.alert.count({ where: { service: hiddenService, source: 'Agent服务监控' } }), 0, 'hidden baseline should not create alerts')
  assert.equal((await getDashboardData()).services.some((service) => service.name === hiddenService), false, 'hidden baseline should not appear in dashboard service aggregation')

  await ingestHostServices(windowsHostId, [])
  const stillHidden = await prisma.hostService.findFirstOrThrow({ where: { hostId: windowsHostId, name: hiddenService } })
  assert.equal(stillHidden.status, 'stopped', 'hidden baseline omitted from snapshot should not become missing')
  assert.equal(stillHidden.metadata?.hiddenStoppedBaseline, true, 'hidden baseline should stay hidden when omitted')
  assert.equal(await prisma.alert.count({ where: { service: hiddenService, source: 'Agent服务监控' } }), 0, 'omitted hidden baseline should not create alerts')

  await ingestHostServices(windowsHostId, [windowsService(hiddenService, 'running')])
  const nowVisible = await prisma.hostService.findFirstOrThrow({ where: { hostId: windowsHostId, name: hiddenService } })
  assert.equal(nowVisible.metadata?.hiddenStoppedBaseline, false, 'service should become visible after it reports running')
  assert.equal(nowVisible.metadata?.everHealthy, true, 'service should remember it has been healthy')
  assert.equal((await getHostServices(windowsHostId)).some((service) => service.name === hiddenService), true, 'service should appear after becoming running')

  await ingestHostServices(windowsHostId, [windowsService(hiddenService, 'stopped')])
  assert.ok(await prisma.serviceEvent.findFirst({ where: { hostId: windowsHostId, service: hiddenService, eventType: 'service_not_running' } }), 'once-healthy service should create stopped event')
  assert.ok(await prisma.alert.findFirst({ where: { service: hiddenService, source: 'Agent服务监控', status: { not: '已解决' } } }), 'once-healthy service should create stopped alert')

  await ingestHostServices(windowsHostId, [windowsService(serviceName, 'running')])
  const active = await prisma.hostService.findFirstOrThrow({ where: { hostId: windowsHostId, name: serviceName } })
  assert.equal(active.status, 'running', 'baseline running Windows service should be stored')

  await ingestHostServices(windowsHostId, [windowsService(serviceName, 'stopped')])
  const stopped = await prisma.hostService.findFirstOrThrow({ where: { hostId: windowsHostId, name: serviceName } })
  assert.equal(stopped.status, 'stopped', 'stopped Windows service should remain visible')

  const stoppedEvent = await prisma.serviceEvent.findFirst({ where: { hostId: windowsHostId, service: serviceName, eventType: 'service_not_running' } })
  assert.ok(stoppedEvent, 'Windows stopped transition should create a service event')
  const alert = await prisma.alert.findFirst({ where: { service: serviceName, source: 'Agent服务监控', status: { not: '已解决' } } })
  assert.ok(alert, 'Windows stopped transition should create an alert-center alert')
  assert.equal(alert.fingerprint, fingerprint, 'service alert should use explicit per-host/service fingerprint')

  await ingestHostServices(windowsHostId, [windowsService(serviceName, 'running')])
  const resolvedAlert = await prisma.alert.findUniqueOrThrow({ where: { id: alert.id } })
  assert.equal(resolvedAlert.status, '已解决', 'recovered Windows service should auto-resolve the active service alert')
  assert.ok(resolvedAlert.metadata?.recovery, 'resolved alert should keep recovery metadata')

  await ingestHostServices(windowsHostId, [windowsService(otherService, 'running')])
  const removed = await prisma.hostService.findFirst({ where: { hostId: windowsHostId, name: serviceName } })
  assert.equal(removed, null, 'Windows service omitted from latest snapshot should leave current service health')
  assert.equal((await getHostServices(windowsHostId)).some((service) => service.name === serviceName), false, 'removed Windows service should no longer appear in host service list')
  assert.equal((await getDashboardData()).services.some((service) => service.name === serviceName), false, 'removed Windows service should no longer appear in dashboard service health')

  await ingestHostServices(windowsHostId, [windowsService(otherService, 'stopped')])
  const removedServiceAlert = await prisma.alert.findFirstOrThrow({ where: { service: otherService, source: 'Agent服务监控', status: { not: '已解决' } } })
  await ingestHostServices(windowsHostId, [])
  assert.equal(await prisma.hostService.findFirst({ where: { hostId: windowsHostId, name: otherService } }), null, 'empty service snapshot should remove stale current services')
  assert.equal((await prisma.alert.findUniqueOrThrow({ where: { id: removedServiceAlert.id } })).status, '已解决', 'removing an uninstalled service should resolve its stale service alert')

  await prisma.hostService.create({ data: { hostId: windowsHostId, name: legacyMissingService, status: 'missing', port: 0, source: 'windows-service', metadata: { previousMetadata: { path: 'C:\\Apps\\Legacy\\legacy.exe' }, missingDetectedAt: new Date().toISOString() }, lastReportedAt: new Date() } })
  await ingestHostServices(windowsHostId, [])
  assert.equal(await prisma.hostService.findFirst({ where: { hostId: windowsHostId, name: legacyMissingService } }), null, 'legacy missing service rows without top-level path metadata should also be removed')

  await ingestServiceEvents(windowsHostId, [{ service: eventOnlyService, eventType: 'service_not_running', level: 'ERROR', message: 'event-only service is not running', source: 'windows-service', occurredAt: new Date().toISOString() }])
  const eventDerived = await prisma.hostService.findFirstOrThrow({ where: { hostId: windowsHostId, name: eventOnlyService } })
  assert.equal(eventDerived.status, 'stopped', 'explicit stopped event should create a service row when no snapshot row exists')
  assert.equal(eventDerived.metadata?.detectedFromEvent, true, 'event-derived service row should be marked for diagnostics')
  const eventOnlyAlert = await prisma.alert.findFirst({ where: { service: eventOnlyService, source: 'Agent服务监控', status: { not: '已解决' } } })
  assert.ok(eventOnlyAlert, 'explicit stopped event without service row should create an alert')
  await ingestServiceEvents(windowsHostId, [{ service: eventOnlyService, eventType: 'service_recovered', level: 'INFO', message: 'event-only service is running', source: 'windows-service', occurredAt: new Date().toISOString() }])
  const recoveredEventOnlyAlert = await prisma.alert.findUniqueOrThrow({ where: { id: eventOnlyAlert.id } })
  assert.equal(recoveredEventOnlyAlert.status, '已解决', 'explicit recovery event should resolve event-derived service alert')

  const linuxCount = await ingestHostServices(linuxHostId, [{ name: linuxService, status: 'failed', source: 'systemd', lastReportedAt: new Date().toISOString() }])
  assert.equal(linuxCount, 0, 'Linux ordinary services should be ignored')
  assert.equal(await prisma.hostService.count({ where: { hostId: linuxHostId } }), 0, 'Linux ordinary service rows should not be stored')
  assert.equal(await prisma.alert.count({ where: { service: linuxService, source: 'Agent服务监控' } }), 0, 'Linux ordinary services should not create alerts')

  const linuxEventCount = await ingestServiceEvents(linuxHostId, [{ service: linuxService, eventType: 'service_failed', level: 'ERROR', message: 'failed', source: 'systemd', occurredAt: new Date().toISOString() }])
  assert.equal(linuxEventCount, 0, 'Linux ordinary service events should be ignored')
  assert.equal(await prisma.serviceEvent.count({ where: { hostId: linuxHostId } }), 0, 'Linux ordinary service events should not be stored')
  assert.equal(await prisma.alert.count({ where: { service: linuxService, source: 'Agent服务监控' } }), 0, 'Linux ordinary service events should not create alerts')

  console.log('agent-service-state-alert-ok')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
