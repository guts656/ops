import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../server/remote/agentInstaller.ts', import.meta.url), 'utf8')
const windowsAgentSource = source.match(/@'\n([\s\S]*?)\n'@ \| Set-Content -Encoding UTF8 -Path \(Join-Path \$base 'ops-platform-agent\.ps1'\)/)?.[1] ?? ''
const parserSource = windowsAgentSource.match(/function Read-SimpleJsonString\([\s\S]*?(?=\nfunction ConvertFrom-OpsJson)/)?.[0] ?? ''

assert.ok(parserSource, 'legacy PowerShell JSON fallback should be extractable')

const verification = String.raw`
$raw = '{"job":{"id":"job-1","type":"batch_file_operation","action":"upload_file","batchJobId":"batch-1","batchTargetId":"target-1","timeoutSeconds":120,"targetDirectory":"C:\\Ops\\{batch}","fileName":"sample.txt","remotePath":"C:\\Ops\\{batch}\\sample.txt","fileContentBase64":"YWJj","expectedMd5":"900150983cd24fb0d6963f7d28e17f72","maxFileSize":1048576,"persistArtifact":false}}'
$result = ConvertFrom-SimpleJson $raw
if (-not $result.job) { throw 'nested job was not parsed' }
if ($result.job.id -ne 'job-1') { throw 'job id mismatch' }
if ($result.job.type -ne 'batch_file_operation') { throw 'job type mismatch' }
if ($result.job.action -ne 'upload_file') { throw 'job action mismatch' }
if ($result.job.batchJobId -ne 'batch-1' -or $result.job.batchTargetId -ne 'target-1') { throw 'batch identifiers mismatch' }
if ($result.job.timeoutSeconds -ne 120 -or $result.job.maxFileSize -ne 1048576) { throw 'numeric field mismatch' }
if ($result.job.targetDirectory -ne 'C:\Ops\{batch}') { throw 'target directory mismatch' }
if ($result.job.remotePath -ne 'C:\Ops\{batch}\sample.txt') { throw 'remote path mismatch' }
if ($result.job.fileContentBase64 -ne 'YWJj') { throw 'file content mismatch' }
if ($result.job.persistArtifact -ne $false) { throw 'boolean field mismatch' }
`

const encodedCommand = Buffer.from(`${parserSource}\n${verification}`, 'utf16le').toString('base64')
const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh', 'powershell']
let execution
for (const executable of candidates) {
  const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], { encoding: 'utf8' })
  if (!result.error || result.error.code !== 'ENOENT') {
    execution = result
    break
  }
}

if (execution) {
  assert.equal(execution.status, 0, `legacy JSON fallback failed:\n${execution.stdout}\n${execution.stderr}`)
  console.log('windows-agent-simple-json-parser-ok')
} else {
  console.log('windows-agent-simple-json-parser-skipped: PowerShell not found')
}
