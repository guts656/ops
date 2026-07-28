import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const agentRoutes = await readFile(new URL('../server/routes/agentMetrics.ts', import.meta.url), 'utf8')
const hostRoutes = await readFile(new URL('../server/routes/hosts.ts', import.meta.url), 'utf8')
const dataSource = await readFile(new URL('../server/data/logCollectionStatus.ts', import.meta.url), 'utf8')
const panelSource = await readFile(new URL('../src/components/hosts/HostLogCollectionStatusPanel.tsx', import.meta.url), 'utf8')
const migration = await readFile(new URL('../prisma/migrations/20260727090000_add_host_log_collection_statuses/migration.sql', import.meta.url), 'utf8')

assert.match(migration, /CREATE TABLE IF NOT EXISTS "host_log_collection_statuses"/, 'migration should create the log collection status table')
assert.match(migration, /CONSTRAINT "host_log_collection_statuses_host_id_fkey"/, 'status rows should be tied to hosts')
assert.match(dataSource, /upsertHostLogCollectionStatus/, 'backend should store latest agent diagnostics')
assert.match(dataSource, /ON CONFLICT \(host_id\) DO UPDATE/, 'status storage should keep one latest row per host')
assert.match(agentRoutes, /router\.post\('\/hosts\/:id\/log-status'/, 'agent should have an authenticated log status endpoint')
assert.match(hostRoutes, /router\.get\('\/:id\/log-collection-status'/, 'host detail should expose latest log status')
assert.match(panelSource, /日志采集诊断/, 'host detail should render the diagnostics panel')

console.log('agent-log-collection-status-ok')
