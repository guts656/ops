import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { resolveAlert } from '../server/data/alerts.ts'
import { ingestAlert } from '../server/services/alertIngestionService.ts'

const now = Date.now()
const fingerprint = `manual-resolve-cooldown-${now}`

async function cleanup() {
  await prisma.alert.deleteMany({ where: { fingerprint } })
  await prisma.alertNoiseRecord.deleteMany({ where: { fingerprint } })
}

try {
  await cleanup()
  process.env.ALERT_MANUAL_RESOLVE_COOLDOWN_MINUTES = '10'

  const first = await ingestAlert({
    source: 'Agent服务监控',
    level: '严重',
    service: `cooldown-service-${now}`,
    title: '服务异常冷却测试',
    content: 'service stopped',
    relatedType: 'host_service',
    relatedId: `host-service-${now}`,
    fingerprint,
    metadata: { currentStatus: 'stopped' },
  })
  assert.ok(first.alert, 'first abnormal occurrence should create an alert')
  await resolveAlert(first.alert.id, 'smoke')

  const skipped = await ingestAlert({
    source: 'Agent服务监控',
    level: '严重',
    service: `cooldown-service-${now}`,
    title: '服务异常冷却测试',
    content: 'service still stopped in cooldown',
    relatedType: 'host_service',
    relatedId: `host-service-${now}`,
    fingerprint,
    metadata: { currentStatus: 'stopped' },
  })
  assert.equal(skipped.skipped, true, 'manual resolved alert should be muted during cooldown')
  assert.equal(skipped.skippedReason, 'manual_resolved', 'cooldown skip should keep manual_resolved reason')

  await prisma.alert.update({ where: { id: first.alert.id }, data: { updatedAt: new Date(Date.now() - 11 * 60_000) } })
  const reopened = await ingestAlert({
    source: 'Agent服务监控',
    level: '严重',
    service: `cooldown-service-${now}`,
    title: '服务异常冷却测试',
    content: 'service still stopped after cooldown',
    relatedType: 'host_service',
    relatedId: `host-service-${now}`,
    fingerprint,
    metadata: { currentStatus: 'stopped' },
  })
  assert.ok(reopened.alert, 'abnormal service should alert again after manual-resolve cooldown')
  assert.notEqual(reopened.alert.id, first.alert.id, 'post-cooldown occurrence should create a new active alert')
  assert.equal(reopened.alert.status, '待处理', 'post-cooldown alert should be active')

  console.log('alert-manual-resolve-cooldown-ok')
} finally {
  await cleanup()
  delete process.env.ALERT_MANUAL_RESOLVE_COOLDOWN_MINUTES
  await prisma.$disconnect()
}
