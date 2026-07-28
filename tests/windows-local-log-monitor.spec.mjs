import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const installer = await readFile(new URL('../server/remote/agentInstaller.ts', import.meta.url), 'utf8')
const agentRoutes = await readFile(new URL('../server/routes/agentMetrics.ts', import.meta.url), 'utf8')
const monitorData = await readFile(new URL('../server/data/logMonitorRules.ts', import.meta.url), 'utf8')
const watchdog = await readFile(new URL('../server/services/agentLogUploadWatchdog.ts', import.meta.url), 'utf8')
const windowsAgentSource = installer.match(/@'\n([\s\S]*?)\n'@ \| Set-Content -Encoding UTF8 -Path \(Join-Path \$base 'ops-platform-agent\.ps1'\)/)?.[1] ?? ''

assert.match(agentRoutes, /router\.get\('\/hosts\/:id\/log-monitor-config'/, 'agent API should expose local log monitor config')
assert.match(agentRoutes, /router\.post\('\/hosts\/:id\/log-monitor-results'/, 'agent API should accept local log monitor results')
assert.match(monitorData, /getAgentLocalLogMonitorConfig/, 'backend should build host-scoped local monitor config')
assert.match(monitorData, /ingestAgentLocalLogMonitorResults/, 'backend should ingest local monitor results')
assert.match(monitorData, /rawLogUploaded: false/, 'local monitor alerts should mark raw logs as not uploaded')
assert.match(monitorData, /async function centralLogHostIds/, 'backend should separate central-log hosts from Windows local-monitor hosts')
assert.match(monitorData, /os: \{ not: 'Windows' \}/, 'no-data alerts should ignore Windows local-monitor hosts')
assert.match(monitorData, /Windows 本地日志监控不再检查原始日志入库/, 'central evaluator should skip raw-log no-data alerts for Windows local monitor rules')
assert.match(windowsAgentSource, /function Collect-LocalLogMonitor\(\$state, \$collectionStatus\)/, 'windows agent should evaluate logs locally')
assert.match(windowsAgentSource, /if \(Is-Blank \$parts\[0\]\) \{ continue \}/, 'windows local monitor should skip blank rule ids before using them as hashtable keys')
assert.match(windowsAgentSource, /if \(Is-Blank \$ruleId\) \{ return \$null \}/, 'windows local monitor should guard blank rule result keys')
assert.match(windowsAgentSource, /if \(-not \$monitorResult\) \{ continue \}/, 'windows local monitor should skip invalid rules without failing collection')
assert.match(windowsAgentSource, /rawLogUpload = \$false/, 'windows agent should explicitly mark raw log upload disabled')
assert.doesNotMatch(windowsAgentSource, /Post-Json "\/api\/agent\/hosts\/\$\(.*?\)\/logs"/, 'windows agent should not upload raw log batches')
assert.match(watchdog, /if \(host\.os === 'Windows'\) continue/, 'raw log upload watchdog should skip Windows local-monitor hosts')

console.log('windows-local-log-monitor-ok')
