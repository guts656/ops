import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { getDashboardData } from '../server/data/dashboard.ts'
import { getHostContainers, ingestHostContainers } from '../server/data/hostContainers.ts'
import { getServiceTopology } from '../server/data/topology.ts'

const now = Date.now()
const hostId = `host-container-lifecycle-${now}`
const serviceName = `demo-container-${now}`
const stoppedName = `stopped-container-${now}`

async function cleanup() {
  await prisma.host.deleteMany({ where: { id: hostId } })
}

function hostData() {
  return {
    id: hostId,
    ip: `10.251.${now % 200}.${now % 250}`,
    hostname: `container-lifecycle-${now}`,
    os: 'Linux',
    osVersion: 'Smoke Linux',
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
    sshPort: 22,
    owner: 'smoke',
    changeNo: 'SMOKE',
  }
}

function container({ id, name = serviceName, state = 'running', status = 'Up 1 second', labels = {} }) {
  return {
    containerId: id,
    name,
    image: 'busybox:latest',
    status,
    state,
    restartCount: 0,
    labels,
    lastReportedAt: new Date().toISOString(),
  }
}

const labels = {
  'com.docker.compose.project': `compose-${now}`,
  'com.docker.compose.service': serviceName,
}

try {
  await cleanup()
  await prisma.host.create({ data: hostData() })

  await prisma.hostService.create({ data: { hostId, name: `stale-linux-service-${now}.service`, status: 'failed', source: 'systemd', lastReportedAt: new Date() } })
  await ingestHostContainers(hostId, [container({ id: `old-${now}`, labels })])
  const first = await prisma.hostContainer.findFirstOrThrow({ where: { hostId, containerId: `old-${now}` } })
  assert.equal(first.isCurrent, true, 'initial running container should be current')
  assert.equal(first.logicalKey, `compose:compose-${now}:${serviceName}`, 'compose labels should build a stable logical key')
  assert.deepEqual((await getHostContainers(hostId)).map((item) => item.containerId), [`old-${now}`], 'current container API should return initial container')

  await ingestHostContainers(hostId, [
    container({ id: `old-${now}`, state: 'exited', status: 'Exited (0) 2 seconds ago', labels }),
    container({ id: `new-${now}`, state: 'running', status: 'Up 1 second', labels }),
  ])
  const retiredOld = await prisma.hostContainer.findFirstOrThrow({ where: { hostId, containerId: `old-${now}` } })
  const currentNew = await prisma.hostContainer.findFirstOrThrow({ where: { hostId, containerId: `new-${now}` } })
  assert.equal(retiredOld.isCurrent, false, 'old exited container with active replacement should be retired')
  assert.equal(retiredOld.retiredReason, 'superseded_by_active_container', 'old replacement should record retired reason')
  assert.ok(retiredOld.retiredAt, 'old replacement should record retired time')
  assert.equal(currentNew.isCurrent, true, 'new running replacement should be current')
  assert.deepEqual((await getHostContainers(hostId)).map((item) => item.containerId), [`new-${now}`], 'current container API should hide retired old container')

  const topology = await getServiceTopology()
  const serviceNode = topology.nodes.find((node) => node.type === 'container-service' && node.hostId === hostId && node.name === serviceName)
  const staleServiceNode = topology.nodes.find((node) => node.type === 'service' && node.hostId === hostId && node.name === `stale-linux-service-${now}.service`)
  assert.ok(serviceNode, 'topology should include the current container service node')
  assert.equal(serviceNode.status, '健康', 'retired old container should not make topology service abnormal')
  assert.equal(serviceNode.instances, 1, 'topology should count only current replacement container')
  assert.equal(staleServiceNode, undefined, 'topology should not include ordinary Linux service nodes')

  await ingestHostContainers(hostId, [
    container({ id: `stopped-${now}`, name: stoppedName, state: 'exited', status: 'Exited (1) 1 second ago' }),
  ])
  const stopped = await prisma.hostContainer.findFirstOrThrow({ where: { hostId, containerId: `stopped-${now}` } })
  assert.equal(stopped.isCurrent, true, 'stopped container without active replacement should remain current')
  assert.equal(stopped.retiredReason, null, 'real stopped container should not be retired')
  assert.deepEqual((await getHostContainers(hostId)).map((item) => item.containerId), [`stopped-${now}`], 'current container API should still show real stopped containers')

  await getDashboardData()

  console.log('agent-container-lifecycle-ok')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
