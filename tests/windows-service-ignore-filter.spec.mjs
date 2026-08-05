import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const [hostServices, serverIndex, agentInstaller, hostData, hostRoutes, hostApi, hostStore, servicePanel, hostDetail, serverHostTypes, clientHostTypes] = await Promise.all([
  source('server/data/hostServices.ts'),
  source('server/index.ts'),
  source('server/remote/agentInstaller.ts'),
  source('server/data/hosts.ts'),
  source('server/routes/hosts.ts'),
  source('src/api/hosts.ts'),
  source('src/stores/hostStore.ts'),
  source('src/components/hosts/HostServicePanel.tsx'),
  source('src/pages/HostDetail.tsx'),
  source('server/types/host.ts'),
  source('src/types/host.ts'),
])

assert.match(hostServices, /metadata\.systemService === true/, 'Windows service ingest should honor Agent systemService metadata')
assert.match(hostServices, /services\.filter\(\(service\) => !isIgnoredService\(service\) && !isWindowsSystemService\(service\)\)/, 'service list should hide ignored and system services')
assert.match(hostServices, /previous && isIgnoredService\(previous\)/, 'ignored services should stay ignored when Agent reports them again')
assert.match(hostServices, /isIgnoredService\(service\) \|\| isWindowsSystemService\(service\)/, 'ignored or system services should not become missing alerts')
assert.match(hostServices, /event\.source === 'windows-service' && isWindowsSystemServiceName\(event\.service\)/, 'Windows system service events should be ignored')
assert.match(hostServices, /'gupdate'/, 'Google Update service should be excluded from service health')
assert.match(hostServices, /'gupdatem'/, 'Google Update machine service should be excluded from service health')
assert.match(hostServices, /'google'/, 'all Google-prefixed services should be excluded from service health')
assert.match(hostServices, /'wisvc'/, 'Windows Insider Service should be excluded from service health')
assert.match(hostServices, /'clipsvc'/, 'Windows Client License Service should be excluded from service health')
assert.match(hostServices, /'scdeviceenum'/, 'Windows Smart Card Device Enumeration Service should be excluded from service health')
assert.match(hostServices, /serviceEvent\.deleteMany/, 'cleanup should remove previously stored Windows system service events')
assert.match(hostServices, /export async function cleanupIgnoredWindowsServiceMonitoring/, 'backend should expose cleanup for previously stored ignored Windows services')
assert.match(serverIndex, /cleanupIgnoredWindowsServiceMonitoring\(\)/, 'API startup should clean previously stored ignored Windows services')
assert.match(agentInstaller, /\$monitoredServices = @\(\$services \| Where-Object \{ \$_\.metadata\.systemService -ne \$true \}\)/, 'Windows Agent should not track system services for transition events')

assert.match(hostData, /export async function ignoreHostServiceRecord/, 'host data should expose ignore service operation')
assert.match(hostData, /ignored:\s*true/, 'ignore operation should persist ignored metadata')
assert.match(hostData, /hostServiceAlertFingerprint/, 'ignore operation should resolve matching service alerts')
assert.match(hostData, /appendAudit\(operator, '忽略服务'/, 'ignore operation should write host audit log')

assert.match(hostRoutes, /services\/:serviceId\/ignore/, 'host routes should expose ignore service endpoint')
assert.match(hostApi, /export async function ignoreHostService/, 'frontend API should call ignore service endpoint')
assert.match(hostStore, /ignoreServiceRecord/, 'host store should expose ignoreServiceRecord')
assert.match(servicePanel, /忽略服务/, 'service panel should render ignore service action')
assert.match(hostDetail, /onIgnore=/, 'host detail should wire ignore action')
assert.match(serverHostTypes, /'忽略服务'/, 'server HostAction should include ignore audit action')
assert.match(clientHostTypes, /'忽略服务'/, 'client HostAction should include ignore audit action')

console.log('windows-service-ignore-filter-ok')
