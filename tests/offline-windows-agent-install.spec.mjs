import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const installerSource = await readFile(new URL('../server/remote/agentInstaller.ts', import.meta.url), 'utf8')
const hostsDataSource = await readFile(new URL('../server/data/hosts.ts', import.meta.url), 'utf8')
const hostsRouteSource = await readFile(new URL('../server/routes/hosts.ts', import.meta.url), 'utf8')
const agentRouteSource = await readFile(new URL('../server/routes/agentMetrics.ts', import.meta.url), 'utf8')
const addHostModalSource = await readFile(new URL('../src/components/AddHostModal.tsx', import.meta.url), 'utf8')
const hostDetailSource = await readFile(new URL('../src/pages/HostDetail.tsx', import.meta.url), 'utf8')
const hostsPageSource = await readFile(new URL('../src/pages/Hosts.tsx', import.meta.url), 'utf8')
const hostStoreSource = await readFile(new URL('../src/stores/hostStore.ts', import.meta.url), 'utf8')

const packageBody = hostsDataSource.match(/export async function createWindowsOfflineAgentPackage[\s\S]*?\n\}\n\nexport async function enrollWindowsOfflineAgent/)?.[0] ?? ''
const enrollBody = hostsDataSource.match(/export async function enrollWindowsOfflineAgent[\s\S]*?\n\}\n\nexport async function reinstallAgent/)?.[0] ?? ''
const addHostsBody = hostsDataSource.match(/export async function addHosts\(values: AddHostFormValues, operator: string\) \{([\s\S]*?)\n\}\n\nexport async function updateHost/)?.[1] ?? ''

assert.match(installerSource, /export function buildWindowsOfflineAgentInstaller/, 'windows offline installer builder should be exported')
assert.match(installerSource, /FromBase64String\('\$\{Buffer\.from\(windowsAgentUpdaterTemplate/, 'windows self-updater should be embedded without nested PowerShell here-strings')
assert.match(installerSource, /offline-enroll/, 'offline installer should enroll with the platform when it runs')
assert.match(installerSource, /Please run this installer as Administrator/, 'offline installer should require Administrator privileges')
assert.match(installerSource, /net session >\$null 2>&1/, 'offline installer should use a legacy-compatible administrator check')
assert.doesNotMatch(installerSource, /Security\.Principal\.WindowsIdentity/, 'offline installer should avoid fragile WindowsIdentity construction on PowerShell 2')
assert.match(installerSource, /schtasks\.exe \/Create \/TN OpsPlatformAgent/, 'offline installer should create the OpsPlatformAgent scheduled task')
assert.match(installerSource, /\/SC MINUTE \/MO \$intervalMinutes \/RU SYSTEM \/RL HIGHEST \/TR \$taskAction/, 'offline installer should use a recurring elevated task')
assert.match(installerSource, /\$taskAction = 'powershell\.exe[^\n]*" once'/, 'scheduled Agent runs should execute one bounded collection cycle')
assert.doesNotMatch(installerSource, /\/SC ONSTART/, 'offline installer should not depend on a single boot-time trigger')
assert.match(installerSource, /cmd\.exe \/c "schtasks\.exe \/End \/TN OpsPlatformAgent >nul 2>nul"/, 'offline installer should ignore missing existing scheduled tasks')
assert.doesNotMatch(installerSource, /schtasks(?:\.exe)? \/End \/TN OpsPlatformAgent 2>\$null/, 'offline installer should not let missing tasks fail under old PowerShell')
assert.match(installerSource, /function Invoke-AgentEnrollment[\s\S]*\$request\.Timeout = 10000[\s\S]*\$request\.ReadWriteTimeout = 10000/, 'offline enrollment should not hang indefinitely')
assert.match(installerSource, /New-Object -TypeName System\.IO\.StreamReader -ArgumentList/, 'offline enrollment should use PowerShell 2 compatible constructor syntax')
assert.match(installerSource, /Agent enrollment failed/, 'offline installer should show a clear enrollment failure')
assert.match(packageBody, /signOfflineAgentInstallerToken/, 'package generation should create a short-lived installer token')
assert.doesNotMatch(packageBody, /agentTokenHash|hashAgentToken|agentTokenVersion/, 'downloading an offline package should not rotate the existing Agent token')
assert.match(enrollBody, /hashAgentToken\(token\)/, 'offline enrollment should rotate the Agent token only when the script runs')
assert.match(enrollBody, /agentTokenVersion: \{ increment: 1 \}/, 'offline enrollment should increment the Agent token version')
assert.match(addHostsBody, /installModeFor\(values, os\)/, 'add host should branch by install mode')
assert.match(addHostsBody, /Windows 主机已保存为离线 Agent 安装模式，未保存 WinRM 密码/, 'offline add should not save Windows credentials')
assert.match(hostsRouteSource, /offline-agent-package/, 'hosts API should expose the offline package download route')
assert.match(agentRouteSource, /offline-enroll/, 'agent API should expose the offline enrollment route')
assert.match(addHostModalSource, /离线安装（推荐）/, 'add host modal should expose the safer Windows offline mode')
assert.match(hostDetailSource, /离线安装脚本/, 'host detail should expose offline installer download')
assert.match(hostDetailSource, /待离线安装/, 'host detail should label offline pending hosts clearly')
assert.match(hostsPageSource, /待离线安装/, 'host list should label offline pending hosts clearly')
assert.match(hostStoreSource, /offlineMode \|\| host\.agentStatus === '正常' \? '成功'/, 'offline add results should not remain stuck in processing state')

console.log('offline-windows-agent-install-ok')
