import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { getDashboardData } from '../server/data/dashboard.ts'

try {
  const coldStartedAt = performance.now()
  const [first, second, third] = await Promise.all([getDashboardData(), getDashboardData(), getDashboardData()])
  const coldMs = Math.round(performance.now() - coldStartedAt)
  assert.deepEqual(second, first)
  assert.deepEqual(third, first)

  const cachedStartedAt = performance.now()
  const cached = await getDashboardData()
  const cachedMs = Math.round(performance.now() - cachedStartedAt)
  assert.deepEqual(cached, first)
  assert.ok(cachedMs < 100, `cached dashboard load should be under 100ms, received ${cachedMs}ms`)

  console.log(JSON.stringify({
    coldMs,
    cachedMs,
    sampleCount: first.resourceMonitorMeta.sampleCount,
    totalSampleCount: first.resourceMonitorMeta.totalSampleCount,
    rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
  }))
} finally {
  await prisma.$disconnect()
}
