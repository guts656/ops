import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const [batchData, batchPage] = await Promise.all([
  source('server/data/batchJobs.ts'),
  source('src/pages/BatchJobs.tsx'),
])

assert.match(batchData, /getLinuxSshPrivateKey/, 'batch jobs should use the platform Linux private key')
assert.match(batchData, /host\.os === 'Linux' && !host\.pullCredential\?\.enabled/, 'Linux batch connection should work without saved Pull credentials')
assert.match(batchData, /host\.os === 'Linux'\) return host as BatchTargetHost/, 'Linux targets should not require saved Pull credentials')
assert.match(batchData, /Windows 文件类批处理需要 Agent/, 'Windows file batch jobs should require Agent readiness instead of WinRM credentials')
assert.match(batchData, /type: 'batch_file_operation'/, 'Windows file batch jobs should create Agent file operation jobs')

assert.match(batchPage, /function canUseBatchHost\(host: Host\)/, 'batch page should centralize target eligibility')
assert.match(batchPage, /host\.os === 'Windows' && host\.status === '在线' && host\.agentStatus === '正常'/, 'Windows hosts should be selectable by Agent readiness')
assert.match(batchPage, /function canUseBatchHostForType\(host: Host, jobType: BatchJobType\)/, 'batch page should select Windows script targets by Agent readiness')
assert.match(batchPage, /平台 SSH 密钥/, 'batch page should explain Linux platform key execution')
assert.match(batchPage, /Agent 通道/, 'batch page should explain Windows Agent execution')
assert.match(batchPage, /Agent 文件通道/, 'batch page should explain Windows Agent file execution')

console.log('batch-jobs-passwordless-hosts-ok')
