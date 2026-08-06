import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { toAuthUser } from '../server/data/users.ts'
import { signToken } from '../server/utils/jwt.ts'

const apiUrl = process.env.API_URL || 'http://127.0.0.1:3001/api'

async function requestDashboard(token) {
  const startedAt = performance.now()
  const response = await fetch(`${apiUrl}/dashboard`, { headers: { Authorization: `Bearer ${token}` } })
  const body = await response.json()
  assert.equal(response.status, 200, JSON.stringify(body))
  assert.ok(body.data?.metrics?.length, 'dashboard response should contain metrics')
  return { elapsedMs: Math.round(performance.now() - startedAt), body }
}

try {
  const storedUser = await prisma.user.findUniqueOrThrow({ where: { username: 'admin' }, include: { customPermissions: true } })
  const token = signToken(toAuthUser(storedUser))

  const concurrentStartedAt = performance.now()
  const concurrent = await Promise.all([requestDashboard(token), requestDashboard(token), requestDashboard(token)])
  const concurrentMs = Math.round(performance.now() - concurrentStartedAt)
  assert.deepEqual(concurrent[1].body, concurrent[0].body)
  assert.deepEqual(concurrent[2].body, concurrent[0].body)

  const cached = await requestDashboard(token)
  assert.ok(cached.elapsedMs < 200, `cached HTTP dashboard load should be under 200ms, received ${cached.elapsedMs}ms`)
  console.log(JSON.stringify({ concurrentMs, requestMs: concurrent.map((item) => item.elapsedMs), cachedMs: cached.elapsedMs }))
} finally {
  await prisma.$disconnect()
}
