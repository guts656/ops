import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const source = readFileSync('server/remote/agentInstaller.ts', 'utf8')

assert.match(source, /def collect_metrics\(\):/, 'Linux Agent should define push metrics collection')
assert.match(source, /def collect_cpu_percent\(\):/, 'Linux Agent should collect CPU from /proc/stat')
assert.match(source, /def collect_memory_percent\(\):/, 'Linux Agent should collect memory from /proc/meminfo')
assert.match(source, /def collect_disk_percent\(\):/, 'Linux Agent should collect disk usage')
assert.match(source, /post\('\/api\/agent\/hosts\/' \+ HOST_ID \+ '\/metrics', collect_metrics\(\)\)/, 'Linux Agent collect_once should post metrics every cycle')

console.log('linux-agent-push-metrics-ok')
