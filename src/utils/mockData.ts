import type { Host, HostAuditLog, HostResourcePoint } from '../types/host'

export const hostGroups = ['核心交易区', '支付专区', '风控专区', 'DCORE OFFICE', '测试资源池']
export const hostTags = ['生产', '数据库', '中间件', '支付', '风控', 'Windows', 'Linux', '高可用', '批处理']

function simpleHash(input: string) {
  let hash = 0
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(index)
    hash |= 0
  }
  return Math.abs(hash).toString(16).padStart(8, '0')
}

export function buildHostAuditHashChain(logs: Omit<HostAuditLog, 'previousHash' | 'hash'>[]): HostAuditLog[] {
  return logs.map((log, index) => {
    const previousHash = index === 0 ? 'HOST-GENESIS-2026' : simpleHash(JSON.stringify(logs[index - 1]))
    const hash = simpleHash(`${previousHash}:${JSON.stringify(log)}`)
    return { ...log, previousHash, hash }
  })
}

function trend(seed: number): HostResourcePoint[] {
  return Array.from({ length: 24 }, (_, index) => {
    const hour = String(index).padStart(2, '0')
    return {
      time: `${hour}:00`,
      cpu: Math.min(96, Math.max(8, seed + Math.round(Math.sin(index / 2) * 13) + (index % 5) * 2)),
      memory: Math.min(98, Math.max(18, seed + 18 + Math.round(Math.cos(index / 3) * 9))),
      disk: Math.min(99, Math.max(22, seed + 28 + Math.round(index / 3))),
    }
  })
}

const inactiveMaintenance = { enabled: false, active: false }

export const mockHosts: Host[] = [
  {
    id: 'host-001',
    ip: '10.16.1.21',
    hostname: 'trade-core-01',
    os: 'Linux',
    osVersion: 'Ubuntu 22.04 LTS',
    cpu: 42,
    memory: 68,
    disk: 72,
    status: '在线',
    group: '核心交易区',
    tags: ['生产', 'Linux', '高可用'],
    agentVersion: 'v2.8.4',
    agentStatus: '正常',
    agentInstalledAt: '2026-02-18 10:32:00',
    lastHeartbeat: '2026-05-22 14:03:18',
    sshPort: 22,
    owner: '交易运维组',
    changeNo: 'CHG-20260520-011',
    maintenance: inactiveMaintenance,
  },
  {
    id: 'host-002',
    ip: '10.16.1.22',
    hostname: 'trade-core-02',
    os: 'Linux',
    osVersion: 'Ubuntu 22.04 LTS',
    cpu: 73,
    memory: 81,
    disk: 89,
    status: '在线',
    group: '核心交易区',
    tags: ['生产', 'Linux', '数据库'],
    agentVersion: 'v2.8.4',
    agentStatus: '异常',
    agentInstalledAt: '2026-02-18 10:35:00',
    lastHeartbeat: '2026-05-22 13:58:41',
    sshPort: 22,
    owner: '交易运维组',
    changeNo: 'CHG-20260520-011',
    maintenance: inactiveMaintenance,
  },
  {
    id: 'host-003',
    ip: '10.18.8.45',
    hostname: 'pay-gateway-01',
    os: 'Linux',
    osVersion: 'Rocky Linux 9.3',
    cpu: 36,
    memory: 54,
    disk: 61,
    status: '在线',
    group: '支付专区',
    tags: ['生产', '支付', '高可用'],
    agentVersion: 'v2.7.9',
    agentStatus: '正常',
    agentInstalledAt: '2026-03-03 09:12:00',
    lastHeartbeat: '2026-05-22 14:03:09',
    sshPort: 22022,
    owner: '支付平台组',
    changeNo: 'CHG-20260518-049',
    maintenance: inactiveMaintenance,
  },
  {
    id: 'host-004',
    ip: '10.19.2.18',
    hostname: 'risk-feature-01',
    os: 'Linux',
    osVersion: 'Debian 12',
    cpu: 58,
    memory: 63,
    disk: 74,
    status: '纳管中',
    group: '风控专区',
    tags: ['风控', 'Linux'],
    agentVersion: 'v2.8.1',
    agentStatus: '安装中',
    agentInstalledAt: '2026-05-22 13:44:00',
    lastHeartbeat: '2026-05-22 13:55:12',
    sshPort: 22,
    owner: '风控运维组',
    changeNo: 'CHG-20260522-090',
    maintenance: inactiveMaintenance,
  },
  {
    id: 'host-005',
    ip: '10.22.4.77',
    hostname: 'office-ad-01',
    os: 'Windows',
    osVersion: 'Windows Server 2022',
    cpu: 22,
    memory: 47,
    disk: 55,
    status: '在线',
    group: 'DCORE OFFICE',
    tags: ['Windows', '中间件'],
    agentVersion: 'v2.7.9',
    agentStatus: '正常',
    agentInstalledAt: '2026-04-09 16:25:00',
    lastHeartbeat: '2026-05-22 14:02:51',
    sshPort: 5985,
    owner: '办公基础架构组',
    changeNo: 'CHG-20260409-112',
    maintenance: inactiveMaintenance,
  },
  {
    id: 'host-006',
    ip: '10.22.4.88',
    hostname: 'office-file-02',
    os: 'Windows',
    osVersion: 'Windows Server 2019',
    cpu: 0,
    memory: 0,
    disk: 67,
    status: '离线',
    group: 'DCORE OFFICE',
    tags: ['Windows'],
    agentVersion: 'v2.6.5',
    agentStatus: '异常',
    agentInstalledAt: '2026-01-12 11:18:00',
    lastHeartbeat: '2026-05-22 08:19:44',
    sshPort: 5985,
    owner: '办公基础架构组',
    changeNo: 'CHG-20260112-076',
    maintenance: inactiveMaintenance,
  },
  {
    id: 'host-007',
    ip: '10.30.9.16',
    hostname: 'batch-recon-01',
    os: 'Linux',
    osVersion: 'CentOS Stream 9',
    cpu: 31,
    memory: 59,
    disk: 82,
    status: '在线',
    group: '测试资源池',
    tags: ['批处理', 'Linux'],
    agentVersion: 'v2.8.4',
    agentStatus: '正常',
    agentInstalledAt: '2026-05-10 15:08:00',
    lastHeartbeat: '2026-05-22 14:03:00',
    sshPort: 22,
    owner: '测试运维组',
    changeNo: 'CHG-20260510-031',
    maintenance: inactiveMaintenance,
  },
]

export const mockHostResourceTrends: Record<string, HostResourcePoint[]> = Object.fromEntries(
  mockHosts.map((host, index) => [host.id, trend(20 + index * 6)]),
)

export const mockHostAuditLogs = buildHostAuditHashChain([
  { id: 'HAUD-001', time: '2026-05-22 09:12:00', operator: 'chen.sre', action: '新增主机', target: 'trade-core-01', result: '成功', detail: '通过变更单 CHG-20260520-011 纳管核心交易主机', retentionUntil: '2033-05-22' },
  { id: 'HAUD-002', time: '2026-05-22 10:30:18', operator: 'li.ops', action: '测试连接', target: 'pay-gateway-01', result: '成功', detail: 'SSH 连通性验证成功，凭据未留存', retentionUntil: '2033-05-22' },
  { id: 'HAUD-003', time: '2026-05-22 11:46:42', operator: 'wang.dba', action: '重新纳管', target: 'risk-feature-01', result: '成功', detail: 'Agent 进入安装中状态', retentionUntil: '2033-05-22' },
  { id: 'HAUD-004', time: '2026-05-22 13:52:11', operator: 'zhao.sre', action: '重启Agent', target: 'office-file-02', result: '失败', detail: '主机离线，无法重启 Agent', retentionUntil: '2033-05-22' },
])
