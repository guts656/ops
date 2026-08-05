import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { evaluateWindowsWeeklyMaintenance } from '../server/services/windowsWeeklyMaintenanceScheduler.ts'

const suffix = Date.now().toString(36)
const scheduledId = `weekly-maintenance-scheduled-${suffix}`
const manualId = `weekly-maintenance-manual-${suffix}`
const linuxId = `weekly-maintenance-linux-${suffix}`
const hostIds = [scheduledId, manualId, linuxId]
const hostnames = hostIds.map((id) => `${id}-hostname`)

function hostData(id, ip, os = 'Windows') {
  return {
    id,
    ip,
    hostname: `${id}-hostname`,
    os,
    osVersion: 'Smoke OS',
    cpu: 0,
    memory: 0,
    disk: 0,
    status: '在线',
    group: '测试资源池',
    tags: [os],
    agentVersion: 'smoke',
    agentStatus: '正常',
    agentInstalledAt: '2026-08-01 00:00:00',
    lastHeartbeat: '2026-08-01 00:00:00',
    sshPort: os === 'Windows' ? 5985 : 22,
    owner: 'smoke',
    changeNo: 'SMOKE',
  }
}

async function cleanup() {
  await prisma.host.deleteMany({ where: { id: { in: hostIds } } })
  await prisma.hostAuditLog.deleteMany({ where: { target: { in: hostnames } } })
}

try {
  await cleanup()
  await prisma.host.createMany({ data: [
    hostData(scheduledId, '10.248.71.1'),
    {
      ...hostData(manualId, '10.248.71.2'),
      maintenanceEnabled: true,
      maintenanceReason: '人工变更',
      maintenanceUntil: new Date('2026-08-08T01:00:00.000Z'),
      maintenanceStartedAt: new Date('2026-08-07T22:00:00.000Z'),
      maintenanceOperator: 'manual-user',
    },
    hostData(linuxId, '10.248.71.3', 'Linux'),
  ] })

  const during = new Date('2026-08-07T23:30:00.000Z') // Saturday 07:30 Asia/Shanghai
  const first = await evaluateWindowsWeeklyMaintenance(during, { hostIds })
  assert.deepEqual(first, { activeWindow: true, entered: 1, exited: 0, skipped: 1, until: '2026-08-08T00:00:00.000Z' })

  const scheduled = await prisma.host.findUniqueOrThrow({ where: { id: scheduledId } })
  assert.equal(scheduled.maintenanceEnabled, true)
  assert.equal(scheduled.maintenanceOperator, '系统定时维护')
  assert.equal(scheduled.maintenanceUntil?.toISOString(), '2026-08-08T00:00:00.000Z')
  assert.match(scheduled.maintenanceReason || '', /每周六 Windows 计划重启维护/)

  const manual = await prisma.host.findUniqueOrThrow({ where: { id: manualId } })
  assert.equal(manual.maintenanceOperator, 'manual-user', 'scheduler must not overwrite active manual maintenance')
  assert.equal(manual.maintenanceUntil?.toISOString(), '2026-08-08T01:00:00.000Z')
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: linuxId } })).maintenanceEnabled, false, 'Linux hosts must be excluded')

  const repeated = await evaluateWindowsWeeklyMaintenance(during, { hostIds })
  assert.equal(repeated.entered, 0, 'repeated ticks must be idempotent')
  assert.equal(repeated.skipped, 2)

  const after = await evaluateWindowsWeeklyMaintenance(new Date('2026-08-08T00:00:00.000Z'), { hostIds })
  assert.deepEqual(after, { activeWindow: false, entered: 0, exited: 1, skipped: 0 })
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: scheduledId } })).maintenanceEnabled, false)
  assert.equal((await prisma.host.findUniqueOrThrow({ where: { id: manualId } })).maintenanceEnabled, true, 'scheduler must not exit manual maintenance')

  console.log('windows-weekly-maintenance-ok')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
