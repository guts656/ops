import assert from 'node:assert/strict'
import { prisma } from '../server/db/prisma.ts'
import { formatAlertHostPrefix, resolveAlertHostTargets } from '../server/services/alertHostContext.ts'

try {
  const host = await prisma.host.findFirst({
    orderBy: { updatedAt: 'desc' },
    select: { id: true, ip: true, hostname: true, tags: true },
  })
  assert.ok(host, 'database should contain at least one managed host')

  const targets = await resolveAlertHostTargets({ metadata: { hostId: host.id } })
  assert.equal(targets.length, 1, 'host metadata should resolve one managed host')
  assert.equal(targets[0].id, host.id)

  const prefix = formatAlertHostPrefix(targets)
  assert.match(prefix, new RegExp(`--${host.ip.replaceAll('.', '\\.')}--`))
  assert.ok(prefix.endsWith(host.hostname || host.ip), 'prefix should end with the managed hostname')
  console.log(`alert-host-context-db-smoke-ok ${prefix}`)
} finally {
  await prisma.$disconnect()
}
