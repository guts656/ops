import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const hostDataSource = await readFile(new URL('../server/data/hosts.ts', import.meta.url), 'utf8')
const hostRoutesSource = await readFile(new URL('../server/routes/hosts.ts', import.meta.url), 'utf8')
const errorHandlerSource = await readFile(new URL('../server/middleware/errorHandler.ts', import.meta.url), 'utf8')
const addHostModalSource = await readFile(new URL('../src/components/AddHostModal.tsx', import.meta.url), 'utf8')
const hostDetailSource = await readFile(new URL('../src/pages/HostDetail.tsx', import.meta.url), 'utf8')
const servicePanelSource = await readFile(new URL('../src/components/hosts/HostServicePanel.tsx', import.meta.url), 'utf8')

const addHostsBody = hostDataSource.match(/export async function addHosts\(values: AddHostFormValues, operator: string\) \{([\s\S]*?)\n\}\n\nexport async function updateHost/)?.[1] ?? ''
const testConnectionBody = hostDataSource.match(/export async function testHostConnection\(values: Partial<AddHostFormValues>, operator: string\) \{([\s\S]*?)\n\}\n\nexport async function addHosts/)?.[1] ?? ''

assert.match(hostRoutesSource, /\/linux-ssh-key/, 'hosts API should expose platform Linux SSH public key info')
assert.match(hostDataSource, /PLATFORM_LINUX_SSH_KEY_REF/, 'server should support platform-managed Linux SSH key references')
assert.match(hostDataSource, /function resolvePrivateKey/, 'server should centralize platform Linux SSH key resolution')
assert.match(hostDataSource, /values\.sshUsername \|\| \(os === 'Linux' \? 'root' : undefined\)/, 'Linux onboarding should default to root when the UI omits sshUsername')
assert.match(hostDataSource, /values\.authType \|\| \(os === 'Linux' \? '密钥' : undefined\)/, 'Linux onboarding should default to platform key auth when the UI omits authType')
assert.match(hostDataSource, /values\.sshPort \|\| \(os === 'Linux' \? 22 : undefined\)/, 'Linux onboarding should default to SSH port 22 when the UI omits sshPort')
assert.match(testConnectionBody, /privateKey: resolvePrivateKey\(credentials\)/, 'test connection should use the real platform private key instead of the internal key reference')
assert.doesNotMatch(testConnectionBody, /privateKey: credentials\.privateKey/, 'test connection should not pass the platform key reference to ssh2')
assert.doesNotMatch(addHostsBody, /upsertPullCredential/, 'new host onboarding should not save automatic Pull credentials')
assert.match(addHostModalSource, /Linux 使用平台专用 SSH 公钥/, 'Linux onboarding should explain platform SSH public key mode')
assert.match(addHostModalSource, /getLinuxSshKeyInfo/, 'Linux onboarding should load the platform public key command')
assert.doesNotMatch(addHostModalSource, /WinRM 远程安装/, 'Windows onboarding should no longer offer password-based WinRM install')
assert.doesNotMatch(hostDetailSource, /AgentCredentialModal/, 'host detail should not show credential-based action modals')
assert.doesNotMatch(hostDetailSource, /启用自动 Pull|拉取指标|刷新主机信息|重新安装 Agent|重启 Agent/, 'host detail should remove credential-based host actions')
assert.match(servicePanelSource, /onStart && onStop/, 'service control buttons should only render when passwordless handlers exist')
assert.match(errorHandlerSource, /请填写远程用户名、认证方式和端口/, 'host onboarding validation errors should be handled as client errors instead of 500s')

console.log('passwordless-onboarding-ui-ok')
