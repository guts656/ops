import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const dataSource = await readFile(new URL('../server/data/logs.ts', import.meta.url), 'utf8')
const pageSource = await readFile(new URL('../src/pages/LogQuery.jsx', import.meta.url), 'utf8')

assert.match(dataSource, /const DEFAULT_QUERY_WINDOW_MS = 60 \* 60 \* 1000/, 'global log queries should keep a short default window')
assert.match(dataSource, /const HOST_FILE_QUERY_WINDOW_MS = 24 \* 60 \* 60 \* 1000/, 'host or file log queries should use a 24h default window for low-frequency logs')
assert.match(dataSource, /if \(filters\.hostId \|\| filters\.source\) return HOST_FILE_QUERY_WINDOW_MS/, 'host/file filters should trigger the wider default window')
assert.match(pageSource, /按主机或文件来源查询默认最近 24 小时/, 'log query page should explain the low-frequency log default window')

console.log('log-query-low-frequency-window-ok')
