import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

async function source(path) {
  return readFile(new URL(`../${path}`, import.meta.url), 'utf8')
}

const [hostData, hostRoutes, agentRoutes, agentInstaller, hostApi, hostStore, hostDetail, servicePanel, jobPanel] = await Promise.all([
  source('server/data/hosts.ts'),
  source('server/routes/hosts.ts'),
  source('server/routes/agentMetrics.ts'),
  source('server/remote/agentInstaller.ts'),
  source('src/api/hosts.ts'),
  source('src/stores/hostStore.ts'),
  source('src/pages/HostDetail.tsx'),
  source('src/components/hosts/HostServicePanel.tsx'),
  source('src/components/hosts/AgentJobPanel.tsx'),
])

assert.match(hostData, /queueWindowsAgentServiceControl/, 'Windows service control should enqueue Agent jobs instead of requiring passwords')
assert.match(hostData, /transport:\s*'agent'/, 'queued Windows service jobs should use the Agent transport')
assert.match(hostData, /export async function restartHostService/, 'server data should expose restartHostService')

assert.match(hostRoutes, /services\/:serviceId\/restart/, 'host routes should expose restart service endpoint')
assert.match(hostRoutes, /optionalAgentCredentialsSchema/, 'service routes should allow passwordless Windows service control')

assert.match(agentRoutes, /\/hosts\/:id\/jobs\/next/, 'Agent API should expose job polling')
assert.match(agentRoutes, /\/hosts\/:id\/jobs\/:jobId\/result/, 'Agent API should accept service job results')
assert.match(agentRoutes, /start_service.*stop_service.*restart_service/s, 'Agent polling should support service control job types')

assert.match(agentInstaller, /function Process-ServiceJobs/, 'Windows Agent should poll service jobs')
assert.match(agentInstaller, /Invoke-ServiceControlJob/, 'Windows Agent should execute service control jobs')
assert.match(agentInstaller, /Stop-Service -Name \$serviceName/, 'Windows Agent should stop services locally')
assert.match(agentInstaller, /Start-Service -Name \$serviceName/, 'Windows Agent should start services locally')

assert.match(hostApi, /restartHostService/, 'frontend API should expose restartHostService')
assert.match(hostStore, /restartService/, 'host store should expose restartService')
assert.match(hostDetail, /onStart=/, 'host detail should wire start service')
assert.match(hostDetail, /onStop=/, 'host detail should wire stop service')
assert.match(hostDetail, /onRestart=/, 'host detail should wire restart service')
assert.match(servicePanel, /重启/, 'service panel should render restart service action')
assert.doesNotMatch(servicePanel, /删除记录/, 'service panel should not render delete record action')
assert.match(jobPanel, /start_service: '启动服务'/, 'Agent job panel should label service start jobs')
assert.match(jobPanel, /agent: 'Agent'/, 'Agent job panel should label Agent transport')

console.log('windows-agent-service-control-ok')
