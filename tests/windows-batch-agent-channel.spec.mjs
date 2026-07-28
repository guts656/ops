import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const batchData = await readFile(new URL('../server/data/batchJobs.ts', import.meta.url), 'utf8')
const agentRoutes = await readFile(new URL('../server/routes/agentMetrics.ts', import.meta.url), 'utf8')
const installer = await readFile(new URL('../server/remote/agentInstaller.ts', import.meta.url), 'utf8')
const page = await readFile(new URL('../src/pages/BatchJobs.tsx', import.meta.url), 'utf8')
const jobPanel = await readFile(new URL('../src/components/hosts/AgentJobPanel.tsx', import.meta.url), 'utf8')

assert.match(batchData, /type: 'batch_run_script'/, 'Windows batch scripts should create Agent jobs')
assert.match(batchData, /scriptBase64: Buffer\.from\(script, 'utf8'\)\.toString\('base64'\)/, 'batch script payload should be base64 encoded for safe JSON transport')
assert.match(batchData, /Windows 主机 Agent 未在线或未正常/, 'Windows Agent readiness should be validated before queuing scripts')
assert.match(agentRoutes, /batch_run_script/, 'Agent polling endpoint should support batch script jobs')
assert.match(agentRoutes, /batchJobTarget\.updateMany/, 'Agent result endpoint should update batch target rows')
assert.match(installer, /function Invoke-BatchScriptJob\(\$job\)/, 'Windows Agent should execute batch script jobs')
assert.match(installer, /FromBase64String\(\$scriptBase64\)/, 'Windows Agent should decode script payload from base64')
assert.doesNotMatch(installer, /\$\{timeoutSeconds\}/, 'PowerShell timeout variable should not be interpolated by the TypeScript template')
assert.match(page, /Agent 通道/, 'Batch UI should label Windows script targets as Agent channel')
assert.match(jobPanel, /batch_run_script: '批处理脚本'/, 'Agent job history should label batch script jobs')

console.log('windows-batch-agent-channel-ok')
