import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const [schema, data, route, page, server] = await Promise.all([
  readFile(new URL('../prisma/schema.prisma', import.meta.url), 'utf8'),
  readFile(new URL('../server/data/ipushMonitorRules.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/routes/ipushMonitors.ts', import.meta.url), 'utf8'),
  readFile(new URL('../src/components/log-monitoring/IpushMonitorPanel.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../server/index.ts', import.meta.url), 'utf8'),
])

assert.match(schema, /model IpushMonitorRule/, 'iPush rules should have a dedicated data model')
assert.match(schema, /encryptedPassword\s+String/, 'iPush passwords should be stored encrypted')
assert.doesNotMatch(data, /password:\s*rule\./, 'API rule conversion must not expose a stored password')
assert.match(data, /decryptSecret/, 'probes should decrypt credentials only at execution time')
assert.match(data, /responseSnippet: result\.responseSnippet/, "only the probe's redacted response may be saved to alert history")
assert.match(route, /password: tokenSchema\.optional/, 'editing a rule should allow retaining the existing password')
assert.match(page, /留空表示保留原密码/, 'the form should explain password retention during edits')
assert.match(page, /xaucode 200_login_ok/, 'the form should default to the confirmed success response')
assert.match(server, /startIpushMonitorEvaluator\(\)/, 'the iPush scheduler should start with the API')

console.log('ipush-monitor-feature-ok')
