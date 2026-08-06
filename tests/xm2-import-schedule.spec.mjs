import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const [page, route, converter] = await Promise.all([
  readFile(new URL('../src/pages/Xm2Converter.tsx', import.meta.url), 'utf8'),
  readFile(new URL('../server/routes/logs.ts', import.meta.url), 'utf8'),
  readFile(new URL('../server/services/xm2MonitorJsonConverter.ts', import.meta.url), 'utf8'),
])

assert.match(page, /validateFields\(\['hostScope', 'hostId', 'hostIds', 'hostGroup', 'daysOfWeek', 'holidayMode', 'holidaysText', 'importEnabled'\]\)/)
assert.match(page, /daysOfWeek: values\.daysOfWeek \?\? \[\]/)
assert.match(page, /生效星期：/)
assert.match(route, /daysOfWeek: input\.daysOfWeek \?\? \[\]/)
assert.match(converter, /cooldownMinutes:\s*3,/, 'new XM2 imports should default to a 3-minute cooldown')
assert.doesNotMatch(converter, /由 xm2 monitor\.json 转换，默认停用/, 'XM2 imports should not add converter details to rule descriptions')

console.log('xm2-import-schedule-ok')
