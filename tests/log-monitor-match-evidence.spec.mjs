import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const [schema, route, data, page] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../server/routes/agentMetrics.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/data/logMonitorRules.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/pages/LogMonitoring.tsx', import.meta.url), 'utf8'),
])

assert.match(schema, /matchEvidence\s+Json\s+@default\("\[\]"\)/, 'log monitor alerts should persist match evidence')
assert.match(route, /matches: z\.array\(localLogMonitorMatchSchema\)\.max\(20\)/, 'agent API should cap evidence rows per rule')
assert.match(route, /evidenceCharacters > 256 \* 1024/, 'agent API should cap total evidence size')
assert.match(data, /matchEvidence: matchEvidence as unknown as Prisma\.InputJsonValue/, 'triggered alerts should store match evidence')
assert.match(data, /hostId: host\.id, sampledAt: windowEnd\.toISOString\(\)/, 'stored evidence should include host and sample time')
assert.match(page, />监视档案<\//, 'log monitor history should expose the archive action')
assert.match(page, /旧告警或旧版 Agent 未保存命中行/, 'archive should explain missing evidence for old alerts')
assert.match(page, /hostLabelById\[evidence\.hostId\]/, 'archive should display host labels instead of internal ids')

console.log('log-monitor-match-evidence-ok')
