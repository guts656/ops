import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const source = await readFile(new URL('../server/data/dashboard.ts', import.meta.url), 'utf8')

assert.match(source, /getAggregatedResourceSamples\(resourceWindowStart\)/, 'dashboard should aggregate resource samples in PostgreSQL')
assert.match(source, /GROUP BY 1/, 'resource history should be reduced before it reaches Node.js')
assert.match(source, /count\(\*\)::bigint AS "sampleCount"/, 'resource aggregation should preserve weighted sample counts')
assert.match(source, /weightedAverageResources\(tradingResourcePoints\)/, 'trading-session averages should remain sample weighted')
assert.match(source, /const DASHBOARD_CACHE_MS = 15_000/, 'dashboard should use a short response cache')
assert.match(source, /if \(dashboardLoad\) return dashboardLoad/, 'concurrent dashboard requests should share one database load')
assert.doesNotMatch(source, /prisma\.hostResourcePoint\.findMany/, 'dashboard must not load every raw resource point into memory')

console.log('dashboard-performance-ok')
