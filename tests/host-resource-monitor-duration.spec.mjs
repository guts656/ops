import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const [schema, route, data, types, panel] = await Promise.all([
  source('prisma/schema.prisma'),
  source('server/routes/hostResourceMonitors.ts'),
  source('server/data/hostResourceMonitorRules.ts'),
  source('src/types/hostResourceMonitor.ts'),
  source('src/components/log-monitoring/HostResourceMonitorPanel.tsx'),
])

assert.match(schema, /durationMinutes\s+Int\s+@default\(1\)\s+@map\("duration_minutes"\)/, 'resource monitor rule should persist duration minutes')
assert.match(route, /durationMinutes:\s*z\.coerce\.number\(\)\.int\(\)\.positive\(\)\.max\(1440\)\.optional\(\)/, 'route should validate duration minutes')
assert.match(types, /durationMinutes:\s*number/, 'rule type should expose duration minutes')
assert.match(types, /durationMinutes\?:\s*number/, 'rule input should accept duration minutes')
assert.match(data, /durationMinutes:\s*rule\.durationMinutes \?\? 1/, 'backend should default duration when reading existing rows')
assert.match(data, /durationMinutes:\s*clampInt\(input\.durationMinutes,\s*1,\s*1,\s*1440\)/, 'backend should clamp duration input')
assert.match(data, /prisma\.hostResourcePoint\.findMany/, 'duration evaluation should use resource history points')
assert.match(data, /allAboveThreshold/, 'duration evaluation should require all sampled values to stay above threshold')
assert.match(data, /windowCovered/, 'duration evaluation should require enough history to cover the window')
assert.match(data, /\$\{label\} .*?\$\{durationMinutes\} .*?\$\{rule\.threshold\}/, 'alert content should mention sustained duration')
assert.match(data, /function hostTagText\(host: HostTarget\)/, 'resource alert content should include host tags')
assert.match(data, /const hostInfo = `\$\{hostTagText\(host\)\}--\$\{host\.ip\}--\$\{hostNameText\(host\)\}`/, 'resource alert content should render compact tags-ip-host prefix')
assert.match(data, /select: \{ id: true, ip: true, hostname: true, group: true, tags: true/, 'resource evaluator should load host tags')
assert.match(data, /hostIp: host\.ip, group: host\.group, tags: host\.tags/, 'resource alert metadata should include host tags')
assert.match(panel, /durationMinutes:\s*values\.durationMinutes/, 'UI should submit duration minutes')
assert.match(panel, /durationMinutes:\s*1/, 'UI should default duration to 1 minute')
assert.match(panel, /name="durationMinutes"/, 'UI form should render duration minutes field')
assert.match(panel, /rule\.durationMinutes \?\? 1/, 'UI table should show sustained duration')

console.log('host-resource-monitor-duration-ok')
