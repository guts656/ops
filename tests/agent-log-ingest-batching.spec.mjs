import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { ingestAgentLogs, queryLogs } from '../server/data/logs.ts'

const now = Date.now()
const hostId = `host-agent-log-batch-${now}`

async function cleanup() {
  await prisma.appLog.deleteMany({ where: { hostId } })
  await prisma.host.deleteMany({ where: { id: hostId } })
}

function chunk(items, size) {
  const chunks = []
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size))
  return chunks
}

try {
  await cleanup()
  await prisma.host.create({
    data: {
      id: hostId,
      ip: `10.254.${now % 200}.${now % 250}`,
      hostname: `agent-log-batch-${now}`,
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
    },
  })

  const dockerLogs = Array.from({ length: 205 }, (_, index) => ({
    timestamp: new Date(now + index).toISOString(),
    service: 'container:batch-smoke',
    level: 'INFO',
    traceId: `docker:batch-smoke:${index}`,
    message: `plain container line ${index}`,
    source: 'docker',
    labels: { containerId: 'batch-smoke', containerName: 'batch-smoke', image: 'busybox' },
  }))
  const fileLogs = Array.from({ length: 7 }, (_, index) => ({
    timestamp: new Date(now + 1000 + index).toISOString(),
    service: 'app.log',
    level: index % 2 ? 'ERROR' : 'INFO',
    traceId: `file:batch-smoke:${index}`,
    message: index % 2 ? `ERROR configured file line ${index}` : `plain configured file line ${index}`,
    source: '/var/app/app.log',
    labels: { logPath: '/var/app/app.log', offset: index * 10 },
  }))

  let inserted = 0
  for (const logs of chunk([...dockerLogs, ...fileLogs], 100)) inserted += await ingestAgentLogs(hostId, logs)
  assert.equal(inserted, 212, 'all first-pass batched logs should be stored')

  const duplicateCount = await ingestAgentLogs(hostId, [dockerLogs[0], fileLogs[0]])
  assert.equal(duplicateCount, 0, 'duplicate trace ids should be ignored on retry')

  const dockerResult = await queryLogs({ hostId, source: 'docker', service: 'container:batch-smoke', pageSize: 100 })
  assert.equal(dockerResult.total, 205, 'docker source query should include all batched container logs')
  assert.ok(dockerResult.data.some((log) => log.message === 'plain container line 204'), 'latest docker line should be queryable')

  const fileResult = await queryLogs({ hostId, source: 'file', service: 'app.log', pageSize: 20 })
  assert.equal(fileResult.total, 7, 'file source query should include specified-path logs')
  assert.ok(fileResult.data.some((log) => log.message === 'plain configured file line 0'), 'plain specified-path line should be stored as INFO')
  assert.ok(fileResult.data.some((log) => log.message === 'ERROR configured file line 1'), 'error specified-path line should be stored as ERROR')

  console.log('agent-log-ingest-batching-ok')
} finally {
  await cleanup()
  await prisma.$disconnect()
}
