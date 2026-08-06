import type { HostContainerItem } from '../types/container'
import type { AddHostFormValues, AgentBackendDiagnosisResult, AgentJob, EditHostValues, Host, HostAuditLog, HostConnectionValues, HostFilters, HostMaintenanceValues, HostResourcePoint } from '../types/host'
import type { HostServiceItem, ServiceEventItem } from '../types/service'
import { http } from './http'

export async function queryHosts(filters: HostFilters): Promise<Host[]> {
  const response = await http.get<{ data: Host[] }>('/hosts', { params: filters })
  return response.data.data
}

export async function getHostDetail(id: string): Promise<Host | undefined> {
  const response = await http.get<{ data: Host }>(`/hosts/${id}`)
  return response.data.data
}

export async function getHostResourceTrend(id: string): Promise<HostResourcePoint[]> {
  const response = await http.get<{ data: HostResourcePoint[] }>(`/hosts/${id}/resource-trend`)
  return response.data.data
}

export async function getHostAuditLogs(): Promise<HostAuditLog[]> {
  const response = await http.get<{ data: HostAuditLog[] }>('/hosts/audit-logs')
  return response.data.data
}

export async function getHostAgentJobs(id: string): Promise<AgentJob[]> {
  const response = await http.get<{ data: AgentJob[] }>(`/hosts/${id}/agent-jobs`)
  return response.data.data
}

export async function getHostServices(id: string): Promise<HostServiceItem[]> {
  const response = await http.get<{ data: HostServiceItem[] }>(`/hosts/${id}/services`)
  return response.data.data
}

export async function getHostContainers(id: string): Promise<HostContainerItem[]> {
  const response = await http.get<{ data: HostContainerItem[] }>(`/hosts/${id}/containers`)
  return response.data.data
}

export async function getHostServiceEvents(id: string): Promise<ServiceEventItem[]> {
  const response = await http.get<{ data: ServiceEventItem[] }>(`/hosts/${id}/service-events`)
  return response.data.data
}

export async function getHostOptions(): Promise<{ groups: string[]; tags: string[]; agentVersions: string[] }> {
  const response = await http.get<{ groups: string[]; tags: string[]; agentVersions: string[] }>('/hosts/options')
  return response.data
}

export async function testHostConnection(values: Partial<AddHostFormValues>): Promise<{ success: boolean; hostname: string; os: 'Linux' | 'Windows'; osVersion?: string; message: string }> {
  const response = await http.post<{ success: boolean; hostname: string; os: 'Linux' | 'Windows'; osVersion?: string; message: string }>('/hosts/test-connection', values)
  return response.data
}

export async function addHosts(values: AddHostFormValues): Promise<Host[]> {
  const response = await http.post<{ data: Host[] }>('/hosts', values)
  return response.data.data
}

export async function updateHost(id: string, values: EditHostValues): Promise<Host> {
  const response = await http.patch<{ data: Host }>(`/hosts/${id}`, values)
  return response.data.data
}

export async function deleteHost(id: string): Promise<{ success: boolean; id: string }> {
  const response = await http.delete<{ success: boolean; id: string }>(`/hosts/${id}`)
  return response.data
}

export async function setHostMaintenance(host: Host, values: HostMaintenanceValues): Promise<Host> {
  const response = await http.patch<{ data: Host }>(`/hosts/${host.id}/maintenance`, values)
  return response.data.data
}

export async function remanageHost(host: Host): Promise<Host> {
  const response = await http.post<{ data: Host }>(`/hosts/${host.id}/remanage`)
  return response.data.data
}

export async function refreshHostInfo(host: Host, credentials: HostConnectionValues): Promise<Host> {
  const response = await http.post<{ data: Host }>(`/hosts/${host.id}/refresh-info`, credentials)
  return response.data.data
}

export async function pullHostMetrics(host: Host, credentials: HostConnectionValues): Promise<Host> {
  const response = await http.post<{ data: Host }>(`/hosts/${host.id}/pull-metrics`, credentials)
  return response.data.data
}

export async function saveHostPullCredential(host: Host, credentials: HostConnectionValues): Promise<Host> {
  const response = await http.post<{ data: Host }>(`/hosts/${host.id}/pull-credential`, credentials)
  return response.data.data
}

export async function disableHostPullCredential(host: Host): Promise<Host> {
  const response = await http.delete<{ data: Host }>(`/hosts/${host.id}/pull-credential`)
  return response.data.data
}

export async function diagnoseAgentBackend(host: Host, credentials: HostConnectionValues): Promise<AgentBackendDiagnosisResult> {
  const response = await http.post<{ data: AgentBackendDiagnosisResult }>(`/hosts/${host.id}/diagnose-agent-backend`, credentials)
  return response.data.data
}

export async function repairAgentBackendRoutes(host: Host, credentials: HostConnectionValues): Promise<AgentBackendDiagnosisResult> {
  const response = await http.post<{ data: AgentBackendDiagnosisResult }>(`/hosts/${host.id}/repair-agent-backend-routes`, credentials)
  return response.data.data
}

export async function reinstallAgent(host: Host, credentials: HostConnectionValues, options?: { apiBaseUrl?: string }): Promise<Host> {
  const response = await http.post<{ data: Host }>(`/hosts/${host.id}/reinstall-agent`, { ...credentials, ...options })
  return response.data.data
}

export async function restartAgent(host: Host, credentials: HostConnectionValues): Promise<Host> {
  const response = await http.post<{ data: Host }>(`/hosts/${host.id}/restart-agent`, credentials)
  return response.data.data
}

export async function startHostService(host: Host, serviceId: string, credentials: HostConnectionValues): Promise<Host> {
  const response = await http.post<{ data: Host }>(`/hosts/${host.id}/services/${serviceId}/start`, credentials)
  return response.data.data
}

export async function stopHostService(host: Host, serviceId: string, credentials: HostConnectionValues): Promise<Host> {
  const response = await http.post<{ data: Host }>(`/hosts/${host.id}/services/${serviceId}/stop`, credentials)
  return response.data.data
}

export async function deleteHostService(host: Host, serviceId: string): Promise<Host> {
  const response = await http.delete<{ data: Host }>(`/hosts/${host.id}/services/${serviceId}`)
  return response.data.data
}
