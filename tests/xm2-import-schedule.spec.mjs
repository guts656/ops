import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [page, route] = await Promise.all([
  readFile(new URL('../src/pages/Xm2Converter.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../server/routes/logs.ts', import.meta.url), 'utf8'),
])

assert.match(page, /validateFields\(\['hostScope', 'hostId', 'hostIds', 'hostGroup', 'daysOfWeek', 'holidayMode', 'holidaysText', 'importEnabled'\]\)/)
assert.match(page, /daysOfWeek: values\.daysOfWeek \?\? \[\]/)
assert.match(page, /生效星期：/)
assert.match(route, /daysOfWeek: input\.daysOfWeek \?\? \[\]/)

console.log('xm2-import-schedule-ok')
