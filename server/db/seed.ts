import 'dotenv/config'
import bcrypt from 'bcryptjs'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient, type Prisma } from '../../src/generated/prisma/client'
import { requireInitialAdminPassword } from '../config/env'
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, type Permission, type Role } from '../config/permissions'
import { alerts as defaultAlerts, logs as defaultLogs } from '../../src/utils/mock'
import { buildHostAuditHashChain } from '../utils/audit'
import type { Host, HostAuditLog, HostResourcePoint } from '../types/host'

const connectionString = process.env.DATABASE_URL

if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) })
const seedDemoData = process.env.SEED_DEMO_DATA !== 'false'

const permissionLabels: Record<Permission, string> = {
  [PERMISSIONS.DASHBOARD_VIEW]: '查看仪表盘',
  [PERMISSIONS.ALERTS_VIEW]: '查看告警中心',
  [PERMISSIONS.ALERTS_MANAGE]: '处理告警中心',
  [PERMISSIONS.NOTIFICATIONS_VIEW]: '查看通知中心',
  [PERMISSIONS.NOTIFICATIONS_MANAGE]: '管理通知中心',
  [PERMISSIONS.ALERT_HANDLING_VIEW]: '查看告警自愈映射',
  [PERMISSIONS.ALERT_HANDLING_MANAGE]: '管理告警自愈映射',
  [PERMISSIONS.LOGS_VIEW]: '查看日志查询',
  [PERMISSIONS.LOGS_MANAGE]: '管理日志监控规则',
  [PERMISSIONS.SSL_CERTIFICATES_VIEW]: '查看SSL证书监控',
  [PERMISSIONS.SSL_CERTIFICATES_MANAGE]: '管理SSL证书监控',
  [PERMISSIONS.TOPOLOGY_VIEW]: '查看服务拓扑',
  [PERMISSIONS.HOSTS_VIEW]: '查看主机管理',
  [PERMISSIONS.HOSTS_MANAGE]: '管理主机',
  [PERMISSIONS.HOSTS_AGENT]: '管理主机 Agent',
  [PERMISSIONS.HOSTS_DELETE]: '删除主机',
  [PERMISSIONS.ACCOUNTS_MANAGE]: '管理账号权限',
  [PERMISSIONS.AUDIT_LOG_VIEW]: '查看审计日志中心',
  [PERMISSIONS.INTERNAL_VIEW]: '查看内部系统',
  [PERMISSIONS.SELF_HEALING_VIEW]: '查看自愈规则',
  [PERMISSIONS.SELF_HEALING_MANAGE]: '管理自愈规则',
  [PERMISSIONS.BATCH_VIEW]: '查看批处理任务',
  [PERMISSIONS.BATCH_EXECUTE]: '执行批处理任务',
  [PERMISSIONS.AI_VIEW]: '查看 AI 助手',
  [PERMISSIONS.INSPECTION_VIEW]: '查看智能巡检',
  [PERMISSIONS.SETTINGS_VIEW]: '查看平台设置',
  [PERMISSIONS.SETTINGS_MANAGE]: '管理平台设置',
}

function defaultUsers(): Array<{ username: string; displayName: string; role: Role; title: string }> {
  return [
    {
      username: process.env.INITIAL_ADMIN_USERNAME || 'admin',
      displayName: process.env.INITIAL_ADMIN_DISPLAY_NAME || '平台管理员',
      role: 'admin',
      title: '拥有全部运维权限',
    },
  ]
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

const defaultHosts: Host[] = [
  { id: 'host-001', ip: '10.16.1.21', hostname: 'trade-core-01', os: 'Linux', osVersion: 'Ubuntu 22.04 LTS', cpu: 42, memory: 68, disk: 72, status: '在线', group: '核心交易区', tags: ['生产', 'Linux', '高可用'], agentVersion: 'v2.8.4', agentStatus: '正常', agentInstalledAt: '2026-02-18 10:32:00', lastHeartbeat: '2026-05-22 14:03:18', sshPort: 22, owner: '交易运维组', changeNo: 'CHG-20260520-011' },
  { id: 'host-002', ip: '10.16.1.22', hostname: 'trade-core-02', os: 'Linux', osVersion: 'Ubuntu 22.04 LTS', cpu: 73, memory: 81, disk: 89, status: '在线', group: '核心交易区', tags: ['生产', 'Linux', '数据库'], agentVersion: 'v2.8.4', agentStatus: '异常', agentInstalledAt: '2026-02-18 10:35:00', lastHeartbeat: '2026-05-22 13:58:41', sshPort: 22, owner: '交易运维组', changeNo: 'CHG-20260520-011' },
  { id: 'host-003', ip: '10.18.8.45', hostname: 'pay-gateway-01', os: 'Linux', osVersion: 'Rocky Linux 9.3', cpu: 36, memory: 54, disk: 61, status: '在线', group: '支付专区', tags: ['生产', '支付', '高可用'], agentVersion: 'v2.7.9', agentStatus: '正常', agentInstalledAt: '2026-03-03 09:12:00', lastHeartbeat: '2026-05-22 14:03:09', sshPort: 22022, owner: '支付平台组', changeNo: 'CHG-20260518-049' },
  { id: 'host-004', ip: '10.19.2.18', hostname: 'risk-feature-01', os: 'Linux', osVersion: 'Debian 12', cpu: 58, memory: 63, disk: 74, status: '纳管中', group: '风控专区', tags: ['风控', 'Linux'], agentVersion: 'v2.8.1', agentStatus: '安装中', agentInstalledAt: '2026-05-22 13:44:00', lastHeartbeat: '2026-05-22 13:55:12', sshPort: 22, owner: '风控运维组', changeNo: 'CHG-20260522-090' },
  { id: 'host-005', ip: '10.22.4.77', hostname: 'office-ad-01', os: 'Windows', osVersion: 'Windows Server 2022', cpu: 22, memory: 47, disk: 55, status: '在线', group: 'DCORE OFFICE', tags: ['Windows', '中间件'], agentVersion: 'v2.7.9', agentStatus: '正常', agentInstalledAt: '2026-04-09 16:25:00', lastHeartbeat: '2026-05-22 14:02:51', sshPort: 5985, owner: '办公基础架构组', changeNo: 'CHG-20260409-112' },
  { id: 'host-006', ip: '10.22.4.88', hostname: 'office-file-02', os: 'Windows', osVersion: 'Windows Server 2019', cpu: 0, memory: 0, disk: 67, status: '离线', group: 'DCORE OFFICE', tags: ['Windows'], agentVersion: 'v2.6.5', agentStatus: '异常', agentInstalledAt: '2026-01-12 11:18:00', lastHeartbeat: '2026-05-22 08:19:44', sshPort: 5985, owner: '办公基础架构组', changeNo: 'CHG-20260112-076' },
  { id: 'host-007', ip: '10.30.9.16', hostname: 'batch-recon-01', os: 'Linux', osVersion: 'CentOS Stream 9', cpu: 31, memory: 59, disk: 82, status: '在线', group: '测试资源池', tags: ['批处理', 'Linux'], agentVersion: 'v2.8.4', agentStatus: '正常', agentInstalledAt: '2026-05-10 15:08:00', lastHeartbeat: '2026-05-22 14:03:00', sshPort: 22, owner: '测试运维组', changeNo: 'CHG-20260510-031' },
]

const defaultHostAudits: HostAuditLog[] = buildHostAuditHashChain([
  { id: 'HAUD-001', time: '2026-05-22 09:12:00', operator: 'chen.sre', action: '新增主机', target: 'trade-core-01', result: '成功', detail: '通过变更单 CHG-20260520-011 纳管核心交易主机', retentionUntil: '2033-05-22' },
  { id: 'HAUD-002', time: '2026-05-22 10:30:18', operator: 'li.ops', action: '测试连接', target: 'pay-gateway-01', result: '成功', detail: 'SSH 连通性验证成功，凭据未留存', retentionUntil: '2033-05-22' },
  { id: 'HAUD-003', time: '2026-05-22 11:46:42', operator: 'wang.dba', action: '重新纳管', target: 'risk-feature-01', result: '成功', detail: 'Agent 进入安装中状态', retentionUntil: '2033-05-22' },
  { id: 'HAUD-004', time: '2026-05-22 13:52:11', operator: 'zhao.sre', action: '重启Agent', target: 'office-file-02', result: '失败', detail: '主机离线，无法重启 Agent', retentionUntil: '2033-05-22' },
])

const defaultSelfHealingRules = [
  {
    id: 'heal-001',
    name: '支付服务错误率自动重启',
    description: '当 payment-service 错误率持续高于阈值时自动重启服务并通知 SRE。',
    priority: 'P0',
    enabled: true,
    triggerCount: 18,
    successRate: 94,
    lastExecutedAt: '2026-05-22 10:42:18',
    logic: 'AND',
    conditions: [
      { dataSource: '指标', metric: 'error_rate', service: 'payment-service', operator: '>', threshold: 3, windowValue: 5, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' },
      { dataSource: '事件', metric: 'instance_unhealthy', service: 'payment-service', operator: '>=', threshold: 2, windowValue: 3, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' },
    ],
    actions: [
      { type: '重启服务', target: 'payment-service', retries: 2, cooldown: 10 },
      { type: '发通知', target: 'sre-payment', retries: 1, cooldown: 1 },
    ],
    notification: { channels: ['钉钉', '邮件'], receivers: 'payment-sre@example.com, 周岚', template: '规则 {{ruleName}} 已触发，服务 {{service}} 当前值 {{value}}。' },
  },
  {
    id: 'heal-002',
    name: '网关延迟自动扩容',
    description: '入口 P95 延迟升高时自动扩容 gateway-service 实例。',
    priority: 'P1',
    enabled: true,
    triggerCount: 11,
    successRate: 89,
    lastExecutedAt: '2026-05-22 10:35:44',
    logic: 'AND',
    conditions: [{ dataSource: '指标', metric: 'p95_latency', service: 'gateway-service', operator: '>=', threshold: 800, windowValue: 10, windowUnit: '分钟', intervalValue: 1, intervalUnit: '分钟' }],
    actions: [{ type: '扩缩容', target: 'gateway-service replicas +2', retries: 1, cooldown: 15 }],
    notification: { channels: ['企业微信'], receivers: '网关值班群', template: '{{service}} 延迟超过阈值，已执行扩容。' },
  },
  {
    id: 'heal-003',
    name: '订单队列堆积消费加速',
    description: '订单队列堆积时执行消费者扩容脚本。',
    priority: 'P1',
    enabled: true,
    triggerCount: 9,
    successRate: 92,
    lastExecutedAt: '2026-05-22 10:28:09',
    logic: 'OR',
    conditions: [
      { dataSource: '指标', metric: 'queue_lag', service: 'order-service', operator: '>', threshold: 8000, windowValue: 5, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' },
      { dataSource: '日志', metric: 'consumer_lag_detected', service: 'order-service', operator: '==', threshold: 1, windowValue: 2, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' },
    ],
    actions: [
      { type: '执行脚本', target: '/opt/scripts/scale-order-consumer.sh', retries: 2, cooldown: 8 },
      { type: '发通知', target: 'order-oncall', retries: 1, cooldown: 1 },
    ],
    notification: { channels: ['钉钉'], receivers: '何予, 订单值班群', template: '{{ruleName}} 已处理，当前堆积 {{value}}。' },
  },
  {
    id: 'heal-004',
    name: '通知服务供应商降级',
    description: '短信供应商错误码波动时切换备用通道。',
    priority: 'P2',
    enabled: false,
    triggerCount: 6,
    successRate: 83,
    lastExecutedAt: '2026-05-21 18:12:33',
    logic: 'AND',
    conditions: [{ dataSource: '日志', metric: 'sms_provider_unstable', service: 'notification-service', operator: '==', threshold: 1, windowValue: 3, windowUnit: '分钟', intervalValue: 1, intervalUnit: '分钟' }],
    actions: [{ type: '执行脚本', target: '/opt/scripts/switch-sms-provider.sh', retries: 1, cooldown: 20 }],
    notification: { channels: ['邮件'], receivers: '唐安', template: '通知服务已切换短信备用供应商。' },
  },
]

const defaultSelfHealingHistory = [
  { id: 'exec-1001', ruleId: 'heal-001', ruleName: '支付服务错误率自动重启', service: 'payment-service', status: '成功', triggeredAt: '2026-05-22 10:42:18', triggerValue: 'error_rate=3.82%', duration: '48s', logs: ['检测到 error_rate 3.82% > 3%', '确认 2 个实例异常', '重启 payment-service 第 1 批实例', '健康检查通过', '发送钉钉和邮件通知'] },
  { id: 'exec-1002', ruleId: 'heal-002', ruleName: '网关延迟自动扩容', service: 'gateway-service', status: '成功', triggeredAt: '2026-05-22 10:35:44', triggerValue: 'p95_latency=842ms', duration: '1m 12s', logs: ['P95 延迟超过 800ms', '扩容 gateway-service replicas +2', '等待新实例 Ready', '流量重新均衡完成'] },
  { id: 'exec-1003', ruleId: 'heal-003', ruleName: '订单队列堆积消费加速', service: 'order-service', status: '成功', triggeredAt: '2026-05-22 10:28:09', triggerValue: 'queue_lag=8240', duration: '35s', logs: ['队列堆积超过阈值', '执行 /opt/scripts/scale-order-consumer.sh', '消费者实例增加到 12', '发送通知'] },
  { id: 'exec-1004', ruleId: 'heal-004', ruleName: '通知服务供应商降级', service: 'notification-service', status: '失败', triggeredAt: '2026-05-21 18:12:33', triggerValue: 'sms_provider_unstable=1', duration: '22s', logs: ['检测到短信供应商波动', '执行备用通道切换脚本', '脚本返回非零退出码', '已通知值班人员人工处理'] },
]

async function seedPermissions() {
  for (const permission of Object.values(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key: permission },
      update: { label: permissionLabels[permission] },
      create: { key: permission, label: permissionLabels[permission] },
    })
  }

  await prisma.rolePermission.deleteMany()
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS) as Array<[Role, Permission[]]>) {
    for (const permission of permissions) {
      await prisma.rolePermission.create({ data: { role, permissionKey: permission } })
    }
  }
}

async function seedUsers() {
  for (const user of defaultUsers()) {
    const existing = await prisma.user.findUnique({ where: { username: user.username } })
    if (existing) continue
    const passwordHash = await bcrypt.hash(requireInitialAdminPassword(), 10)
    await prisma.user.create({
      data: {
        username: user.username,
        passwordHash,
        displayName: user.displayName,
        role: user.role,
        title: user.title,
      },
    })
  }
}

async function seedHosts() {
  const count = await prisma.host.count()
  if (count > 0) return

  for (const [index, host] of defaultHosts.entries()) {
    await prisma.host.create({
      data: {
        ...host,
        resourcePoints: { create: trend(20 + index * 6) },
      },
    })
  }

  for (const log of defaultHostAudits) {
    await prisma.hostAuditLog.create({ data: log })
  }
}


async function seedAlerts() {
  const count = await prisma.alert.count()
  if (count > 0) return

  for (const alert of defaultAlerts) {
    await prisma.alert.create({ data: alert })
  }
}

async function seedAppLogs() {
  const count = await prisma.appLog.count()
  if (count > 0) return

  for (const log of defaultLogs) {
    await prisma.appLog.create({
      data: {
        ...log,
        timestamp: new Date(`${log.time.replace(' ', 'T')}+08:00`),
      },
    })
  }
}

async function seedSelfHealing() {
  const count = await prisma.selfHealingRule.count()
  if (count > 0) return

  for (const rule of defaultSelfHealingRules) {
    await prisma.selfHealingRule.create({ data: rule })
  }

  for (const execution of defaultSelfHealingHistory) {
    await prisma.selfHealingExecution.create({ data: execution })
  }
}

async function main() {
  await seedPermissions()
  await seedUsers()

  if (seedDemoData) {
    await seedHosts()
    await seedAlerts()
    await seedAppLogs()
    await seedSelfHealing()
  }

  await prisma.auditLog.create({
    data: {
      operator: 'system',
      action: '初始化数据',
      target: ROLE_LABELS.admin,
      result: '成功',
      detail: seedDemoData ? '初始化权限、管理员账号和演示数据' : '初始化权限和管理员账号',
    },
  })
}

main()
  .finally(async () => {
    await prisma.$disconnect()
  })
