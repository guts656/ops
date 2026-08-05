import { spawnSync } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { buildWindowsOfflineAgentInstaller } from '../server/remote/agentInstaller.ts'

const installer = buildWindowsOfflineAgentInstaller('192.0.2.16', {
  hostId: 'host-windows-task-regression',
  installerToken: 'test-installer-token',
  apiBaseUrl: 'http://192.0.2.1:18080',
  intervalSeconds: 60,
})
const agentRuntime = installer.content.match(/@'\r?\n([\s\S]*?)\r?\n'@ \| Set-Content -Encoding UTF8 -Path \(Join-Path \$base 'ops-platform-agent\.ps1'\)/)?.[1] ?? ''

assert.match(installer.content, /\/SC MINUTE \/MO \$intervalMinutes \/RU SYSTEM \/RL HIGHEST/, 'generated installer should create a recurring elevated task')
assert.match(installer.content, /\$taskAction = 'powershell\.exe[^\n]*" once'/, 'generated task action should run one bounded Agent cycle')
assert.doesNotMatch(installer.content, /\/SC ONSTART/, 'generated installer should not depend on one boot trigger')
assert.ok(agentRuntime, 'generated Windows Agent runtime should be extractable')

const candidates = process.platform === 'win32' ? ['powershell.exe', 'pwsh.exe'] : ['pwsh', 'powershell']
const directory = await mkdtemp(join(tmpdir(), 'ops-agent-task-test-'))
const scriptPath = join(directory, installer.filename)
const runtimePath = join(directory, 'ops-platform-agent.ps1')
try {
  await writeFile(scriptPath, installer.content, 'utf8')
  await writeFile(runtimePath, agentRuntime, 'utf8')
  const nestedPaths = []
  const nestedScripts = Array.from(agentRuntime.matchAll(/FromBase64String\('([^']+)'\)/g), (match) => Buffer.from(match[1], 'base64').toString('utf8'))
  for (let index = 0; index < nestedScripts.length; index += 1) {
    const nestedPath = join(directory, `nested-${index}.ps1`)
    await writeFile(nestedPath, nestedScripts[index], 'utf8')
    nestedPaths.push(nestedPath)
  }
  assert.match(agentRuntime, /OpsPlatformAgentWatchdog/, 'generated Agent should register the separate watchdog task')
  assert.ok(nestedScripts.some((script) => script.includes('watchdog-status.txt') && script.includes('$staleSeconds = 180')), 'generated Agent should embed the scheduled-task watchdog')
  let execution
  for (const executable of candidates) {
    const escapedPaths = [scriptPath, runtimePath, ...nestedPaths].map((path) => `'${path.replaceAll("'", "''")}'`).join(', ')
    const command = `foreach ($path in @(${escapedPaths})) { $tokens = $null; $errors = $null; [void][System.Management.Automation.Language.Parser]::ParseFile($path, [ref]$tokens, [ref]$errors); if ($errors.Count -gt 0) { $errors | ForEach-Object { Write-Error ($path + ': ' + $_.Message) }; exit 1 } }`
    const encodedCommand = Buffer.from(command, 'utf16le').toString('base64')
    const result = spawnSync(executable, ['-NoProfile', '-NonInteractive', '-EncodedCommand', encodedCommand], { encoding: 'utf8' })
    if (!result.error || result.error.code !== 'ENOENT') {
      execution = result
      break
    }
  }
  if (execution) assert.equal(execution.status, 0, `generated installer PowerShell syntax failed:\n${execution.stdout}\n${execution.stderr}`)
} finally {
  await rm(directory, { recursive: true, force: true })
}

console.log('windows-scheduled-task-installer-ok')
