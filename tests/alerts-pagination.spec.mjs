import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const [route, data, store, list, page, api] = await Promise.all([
  source('server/routes/alerts.ts'),
  source('server/data/alerts.ts'),
  source('src/stores/alertStore.js'),
  source('src/components/AlertList.jsx'),
  source('src/pages/Alerts.jsx'),
  source('src/api/alerts.ts'),
])

assert.match(route, /page:\s*z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.optional\(\)/, 'alerts route should parse page')
assert.match(route, /pageSize:\s*z\.coerce\.number\(\)\.int\(\)\.min\(1\)\.max\(100\)\.optional\(\)/, 'alerts route should parse and cap pageSize')
assert.match(route, /res\.json\(await queryAlerts\(filters\)\)/, 'alerts route should return the paged response directly')

assert.match(data, /prisma\.alert\.count\(\{\s*where\s*\}\)/, 'queryAlerts should count total alerts')
assert.match(data, /skip:\s*\(page - 1\) \* pageSize/, 'queryAlerts should use skip for server-side pagination')
assert.match(data, /take:\s*pageSize/, 'queryAlerts should use take for server-side pagination')
assert.match(data, /return \{ data: await enrichAlertHosts\(alerts\), page, pageSize, total \}/, 'queryAlerts should return page metadata with host target enrichment')
assert.match(data, /select: \{ id: true, ip: true, hostname: true, tags: true, group: true \}/, 'alert host enrichment should load tags and group')

assert.match(api, /Promise<AlertPage>/, 'frontend API should expose the paged alert response')
assert.match(store, /pagination:\s*defaultPagination/, 'alert store should keep pagination state')
assert.match(store, /async changePage\(page, pageSize\)/, 'alert store should expose page changing')
assert.match(store, /queryAlerts\(\{ \.\.\.nextFilters, page: nextPagination\.page, pageSize: nextPagination\.pageSize \}\)/, 'alert store should query with pagination')

assert.match(list, /<Pagination/, 'AlertList should render pagination controls')
assert.match(list, /showTotal=\{\(total\) => `共 \$\{total\} 条告警`\}/, 'AlertList should show total count')
assert.match(page, /pagination=\{pagination\}/, 'Alerts page should pass pagination into AlertList')
assert.match(page, /onPageChange=\{changePage\}/, 'Alerts page should pass page change handler into AlertList')

console.log('alerts-pagination-ok')
