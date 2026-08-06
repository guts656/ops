import { message } from 'antd'
import { create } from 'zustand'
import { addHosts, deleteHost as deleteHostApi, deleteHostService as deleteHostServiceApi, diagnoseAgentBackend as diagnoseAgentBackendApi, disableHostPullCredential as disableHostPullCredentialApi, getHostAgentJobs, getHostAuditLogs, getHostContainers, getHostDetail, getHostOptions, getHostResourceTrend, getHostServiceEvents, getHostServices, pullHostMetrics as pullHostMetricsApi, queryHosts, refreshHostInfo as refreshHostInfoApi, reinstallAgent as reinstallAgentApi, remanageHost as remanageHostApi, repairAgentBackendRoutes as repairAgentBackendRoutesApi, restartAgent as restartAgentApi, saveHostPullCredential as saveHostPullCredentialApi, setHostMaintenance as setHostMaintenanceApi, startHostService as startHostServiceApi, stopHostService as stopHostServiceApi, testHostConnection as testHostConnectionApi, updateHost as updateHostApi } from '../api/hosts'
import { getHostLogs } from '../api/logs'
import type { HostContainerItem } from '../types/container'
import type { AddHostFormValues, AgentBackendDiagnosisResult, AgentJob, BatchAddResult, EditHostValues, Host, HostAuditLog, HostConnectionValues, HostFilters, HostMaintenanceValues, HostResourcePoint } from '../types/host'
import type { AppLog } from '../types/log'
import type { HostServiceItem, ServiceEventItem } from '../types/service'

interface HostStore {
  hosts: Host[]
  selectedHost?: Host
  resourceTrend: HostResourcePoint[]
  auditLogs: HostAuditLog[]
  agentJobs: AgentJob[]
  hostServices: HostServiceItem[]
  hostContainers: HostContainerItem[]
  serviceEvents: ServiceEventItem[]
  hostLogs: AppLog[]
  filters: HostFilters
  groups: string[]
  tags: string[]
  addModalOpen: boolean
  batchResults: BatchAddResult[]
  loading: boolean
  detailLoading: boolean
  load: () => Promise<void>
  refreshHosts: () => Promise<void>
  refreshHostMetrics: (id: string) => Promise<void>
  updateFilters: (filters: HostFilters) => Promise<void>
  openAddModal: () => void
  closeAddModal: () => void
  testConnection: (values: Partial<AddHostFormValues>) => Promise<{ success: boolean; hostname: string; os: 'Linux' | 'Windows'; osVersion?: string; message: string }>
  createHosts: (values: AddHostFormValues) => Promise<void>
  loadHostDetail: (id: string) => Promise<void>
  updateHost: (id: string, values: EditHostValues) => Promise<void>
  deleteHost: (id: string) => Promise<void>
  batchDeleteHosts: (ids: string[]) => Promise<number>
  setHostMaintenance: (id: string, values: HostMaintenanceValues) => Promise<void>
  batchSetMaintenance: (ids: string[], values: HostMaintenanceValues) => Promise<number>
  batchUpdateTags: (ids: string[], tags: string[], mode: 'add' | 'remove') => Promise<number>
  remanageHost: (id: string) => Promise<void>
  refreshHostInfo: (id: string, credentials: HostConnectionValues) => Promise<void>
  pullHostMetrics: (id: string, credentials: HostConnectionValues) => Promise<void>
  saveHostPullCredential: (id: string, credentials: HostConnectionValues) => Promise<void>
  disableHostPullCredential: (id: string) => Promise<void>
  diagnoseAgentBackend: (id: string, credentials: HostConnectionValues) => Promise<AgentBackendDiagnosisResult>
  repairAgentBackendRoutes: (id: string, credentials: HostConnectionValues) => Promise<AgentBackendDiagnosisResult>
  reinstallAgent: (id: string, credentials: HostConnectionValues, options?: { apiBaseUrl?: string }) => Promise<void>
  restartAgent: (id: string, credentials: HostConnectionValues) => Promise<void>
  batchRestartAgent: (ids: string[], credentials: HostConnectionValues) => Promise<number>
  startService: (id: string, serviceId: string, credentials: HostConnectionValues) => Promise<void>
  stopService: (id: string, serviceId: string, credentials: HostConnectionValues) => Promise<void>
  deleteServiceRecord: (id: string, serviceId: string) => Promise<void>
}

function replaceHost(hosts: Host[], updated: Host) {
  return hosts.map((host) => (host.id === updated.id ? updated : host))
}

async function refreshAuditLogs() {
  return getHostAuditLogs()
}

export const useHostStore = create<HostStore>((set, get) => ({
  hosts: [],
  resourceTrend: [],
  auditLogs: [],
  agentJobs: [],
  hostServices: [],
  hostContainers: [],
  serviceEvents: [],
  hostLogs: [],
  filters: {},
  groups: [],
  tags: [],
  addModalOpen: false,
  batchResults: [],
  loading: false,
  detailLoading: false,
  async load() {
    set({ loading: true })
    const [hosts, auditLogs, options] = await Promise.all([queryHosts(get().filters), getHostAuditLogs(), getHostOptions()])
    set({ hosts, auditLogs, groups: options.groups, tags: options.tags, loading: false })
  },
  async refreshHosts() {
    const hosts = await queryHosts(get().filters)
    set({ hosts })
  },
  async refreshHostMetrics(id) {
    const [selectedHost, resourceTrend, hostServices, hostContainers, serviceEvents, hostLogResult] = await Promise.all([getHostDetail(id), getHostResourceTrend(id), getHostServices(id), getHostContainers(id), getHostServiceEvents(id), getHostLogs(id)])
    set((state) => ({ selectedHost, resourceTrend, hostServices, hostContainers, serviceEvents, hostLogs: hostLogResult.data, hosts: selectedHost ? replaceHost(state.hosts, selectedHost) : state.hosts }))
  },
  async updateFilters(filters) {
    set({ loading: true, filters })
    const hosts = await queryHosts(filters)
    set({ hosts, loading: false })
  },
  openAddModal() {
    set({ addModalOpen: true, batchResults: [] })
  },
  closeAddModal() {
    set({ addModalOpen: false, batchResults: [] })
  },
  async testConnection(values) {
    const result = await testHostConnectionApi(values)
    const auditLogs = await refreshAuditLogs()
    set({ auditLogs })
    return result
  },
  async createHosts(values) {
    const ips = values.ips.split('\n').map((ip) => ip.trim()).filter(Boolean)
    set({ batchResults: ips.map((ip) => ({ ip, status: '处理中', message: '正在纳管' })) })
    const newHosts = await addHosts(values)
    const [auditLogs, options] = await Promise.all([refreshAuditLogs(), getHostOptions()])
    const batchResults: BatchAddResult[] = newHosts.map((host) => ({
      ip: host.ip,
      status: host.agentStatus === '正常' ? '成功' : '失败',
      message: host.agentStatus === '正常' ? '已加入纳管任务并安装 Agent' : '主机已保存，Agent 安装未完成，请到详情页查看 Agent 任务日志',
    }))
    const failedCount = batchResults.filter((item) => item.status === '失败').length
    set((state) => ({
      hosts: [...newHosts, ...state.hosts],
      auditLogs,
      groups: options.groups,
      tags: options.tags,
      batchResults,
      addModalOpen: failedCount > 0,
    }))
    if (failedCount > 0) {
      message.warning(`${newHosts.length - failedCount} 台主机纳管成功，${failedCount} 台 Agent 安装异常，已在弹窗中列出`)
    } else {
      message.success(`成功纳管 ${newHosts.length} 台主机`)
    }
  },
  async loadHostDetail(id) {
    set({ detailLoading: true })
    const [selectedHost, resourceTrend, auditLogs, agentJobs, hostServices, hostContainers, serviceEvents, hostLogResult] = await Promise.all([getHostDetail(id), getHostResourceTrend(id), getHostAuditLogs(), getHostAgentJobs(id), getHostServices(id), getHostContainers(id), getHostServiceEvents(id), getHostLogs(id)])
    set({ selectedHost, resourceTrend, auditLogs, agentJobs, hostServices, hostContainers, serviceEvents, hostLogs: hostLogResult.data, detailLoading: false })
  },
  async updateHost(id, values) {
    const updated = await updateHostApi(id, values)
    const [auditLogs, options] = await Promise.all([refreshAuditLogs(), getHostOptions()])
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, auditLogs, groups: options.groups, tags: options.tags }))
  },
  async deleteHost(id) {
    await deleteHostApi(id)
    const auditLogs = await refreshAuditLogs()
    set((state) => ({
      hosts: state.hosts.filter((host) => host.id !== id),
      selectedHost: state.selectedHost?.id === id ? undefined : state.selectedHost,
      auditLogs,
    }))
  },
  async batchDeleteHosts(ids) {
    await Promise.all(ids.map((id) => deleteHostApi(id)))
    const auditLogs = await refreshAuditLogs()
    set((state) => ({
      hosts: state.hosts.filter((host) => !ids.includes(host.id)),
      selectedHost: state.selectedHost && ids.includes(state.selectedHost.id) ? undefined : state.selectedHost,
      auditLogs,
    }))
    return ids.length
  },
  async setHostMaintenance(id, values) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await setHostMaintenanceApi(current, values)
    const auditLogs = await refreshAuditLogs()
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, auditLogs }))
  },
  async batchSetMaintenance(ids, values) {
    const targets = get().hosts.filter((host) => ids.includes(host.id))
    const updatedHosts = await Promise.all(targets.map((host) => setHostMaintenanceApi(host, values)))
    const auditLogs = await refreshAuditLogs()
    set((state) => ({
      hosts: updatedHosts.reduce((items, updated) => (updated ? replaceHost(items, updated) : items), state.hosts),
      selectedHost: updatedHosts.find((host) => host?.id === state.selectedHost?.id) ?? state.selectedHost,
      auditLogs,
    }))
    return updatedHosts.filter(Boolean).length
  },
  async batchUpdateTags(ids, tags, mode) {
    const targets = get().hosts.filter((host) => ids.includes(host.id))
    const updatedHosts = await Promise.all(targets.map((host) => {
      const nextTags = mode === 'add'
        ? Array.from(new Set([...host.tags, ...tags]))
        : host.tags.filter((tag) => !tags.includes(tag))
      return updateHostApi(host.id, { hostname: host.hostname, os: host.os, osVersion: host.osVersion, sshPort: host.sshPort, group: host.group, tags: nextTags })
    }))
    const [auditLogs, options] = await Promise.all([refreshAuditLogs(), getHostOptions()])
    set((state) => ({
      hosts: updatedHosts.reduce((items, updated) => replaceHost(items, updated), state.hosts),
      selectedHost: updatedHosts.find((host) => host.id === state.selectedHost?.id) ?? state.selectedHost,
      auditLogs,
      groups: options.groups,
      tags: options.tags,
    }))
    return updatedHosts.length
  },
  async remanageHost(id) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await remanageHostApi(current)
    const auditLogs = await refreshAuditLogs()
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, auditLogs }))
  },
  async refreshHostInfo(id, credentials) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await refreshHostInfoApi(current, credentials)
    const [auditLogs, agentJobs] = await Promise.all([refreshAuditLogs(), getHostAgentJobs(id)])
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, auditLogs, agentJobs }))
  },
  async pullHostMetrics(id, credentials) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await pullHostMetricsApi(current, credentials)
    const [resourceTrend, auditLogs, agentJobs] = await Promise.all([getHostResourceTrend(id), refreshAuditLogs(), getHostAgentJobs(id)])
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, resourceTrend, auditLogs, agentJobs }))
  },
  async saveHostPullCredential(id, credentials) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await saveHostPullCredentialApi(current, credentials)
    const auditLogs = await refreshAuditLogs()
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, auditLogs }))
  },
  async disableHostPullCredential(id) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await disableHostPullCredentialApi(current)
    const auditLogs = await refreshAuditLogs()
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, auditLogs }))
  },
  async diagnoseAgentBackend(id, credentials) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return { candidates: [] }
    const result = await diagnoseAgentBackendApi(current, credentials)
    const [auditLogs, agentJobs] = await Promise.all([refreshAuditLogs(), getHostAgentJobs(id)])
    set({ auditLogs, agentJobs })
    return result
  },
  async repairAgentBackendRoutes(id, credentials) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return { candidates: [] }
    const result = await repairAgentBackendRoutesApi(current, credentials)
    const [auditLogs, agentJobs] = await Promise.all([refreshAuditLogs(), getHostAgentJobs(id)])
    set({ auditLogs, agentJobs })
    return result
  },
  async reinstallAgent(id, credentials, options) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await reinstallAgentApi(current, credentials, options)
    const [auditLogs, agentJobs] = await Promise.all([refreshAuditLogs(), getHostAgentJobs(id)])
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, auditLogs, agentJobs }))
  },
  async restartAgent(id, credentials) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await restartAgentApi(current, credentials)
    const [auditLogs, agentJobs] = await Promise.all([refreshAuditLogs(), getHostAgentJobs(id)])
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, auditLogs, agentJobs }))
  },
  async batchRestartAgent(ids, credentials) {
    const targets = get().hosts.filter((host) => ids.includes(host.id))
    const updatedHosts = await Promise.all(targets.map((host) => restartAgentApi(host, credentials)))
    const auditLogs = await refreshAuditLogs()
    set((state) => ({
      hosts: updatedHosts.reduce((items, updated) => replaceHost(items, updated), state.hosts),
      selectedHost: updatedHosts.find((host) => host.id === state.selectedHost?.id) ?? state.selectedHost,
      auditLogs,
    }))
    return updatedHosts.length
  },
  async startService(id, serviceId, credentials) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await startHostServiceApi(current, serviceId, credentials)
    const [hostServices, serviceEvents, auditLogs, agentJobs] = await Promise.all([getHostServices(id), getHostServiceEvents(id), refreshAuditLogs(), getHostAgentJobs(id)])
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, hostServices, serviceEvents, auditLogs, agentJobs }))
  },
  async stopService(id, serviceId, credentials) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await stopHostServiceApi(current, serviceId, credentials)
    const [hostServices, serviceEvents, auditLogs, agentJobs] = await Promise.all([getHostServices(id), getHostServiceEvents(id), refreshAuditLogs(), getHostAgentJobs(id)])
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, hostServices, serviceEvents, auditLogs, agentJobs }))
  },
  async deleteServiceRecord(id, serviceId) {
    const current = get().hosts.find((host) => host.id === id) ?? get().selectedHost
    if (!current) return
    const updated = await deleteHostServiceApi(current, serviceId)
    const [hostServices, serviceEvents, auditLogs] = await Promise.all([getHostServices(id), getHostServiceEvents(id), refreshAuditLogs()])
    set((state) => ({ hosts: replaceHost(state.hosts, updated), selectedHost: state.selectedHost?.id === id ? updated : state.selectedHost, hostServices, serviceEvents, auditLogs }))
  },
}))
