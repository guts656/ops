import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../server/remote/winrm.ts', import.meta.url), 'utf8')

assert.match(source, /function Get-OpsWmi\(\$className\)/, 'WinRM test connection should use a WMI helper')
assert.match(source, /Get-Command Get-CimInstance -ErrorAction SilentlyContinue/, 'WinRM test connection should prefer Get-CimInstance when available')
assert.match(source, /return Get-WmiObject \$className/, 'WinRM test connection should fall back to Get-WmiObject for older Windows')
assert.match(source, /function localNtlmUsername\(username: string\)/, 'plain local Windows usernames should have an NTLM retry form')
assert.match(source, /\[localNtlmUsername\(input\.username\), input\.username\]/, 'WinRM should try local NTLM before Basic for plain usernames')

const agentSource = await readFile(new URL('../server/remote/agentInstaller.ts', import.meta.url), 'utf8')
const metricsCommand = agentSource.match(/const windowsMetricsCommand = `([\s\S]*?)`/)?.[1] ?? ''
assert.match(metricsCommand, /function Get-UptimeSeconds\(\$os\)/, 'Windows pull metrics should tolerate invalid WMI boot time values')
assert.match(metricsCommand, /\$uptime = Get-UptimeSeconds \$os/, 'Windows pull metrics should use the safe uptime helper')

console.log('winrm-compatibility-ok')
