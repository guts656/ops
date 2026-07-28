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
assert.match(batchData, /Windows 主机未保存 WinRM Pull 凭据/, 'Windows targets without saved WinRM credentials should fail with a clear message')

assert.match(batchPage, /function canUseBatchHost\(host: Host\)/, 'batch page should centralize target eligibility')
assert.match(batchPage, /return host\.os === 'Linux' \|\| Boolean\(host\.pullCredential\?\.enabled\)/, 'Linux hosts should remain selectable without Pull credentials')
assert.match(batchPage, /function canUseBatchHostForType\(host: Host, jobType: BatchJobType\)/, 'batch page should select Windows script targets by Agent readiness')
assert.match(batchPage, /平台 SSH 密钥/, 'batch page should explain Linux platform key execution')
assert.match(batchPage, /Agent 通道/, 'batch page should explain Windows Agent execution')

console.log('batch-jobs-passwordless-hosts-ok')
