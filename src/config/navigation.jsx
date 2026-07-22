import {
  AlertOutlined,
  BellOutlined,
  CloudServerOutlined,
  ClusterOutlined,
  DashboardOutlined,
  DeploymentUnitOutlined,
  FileSearchOutlined,
  FundProjectionScreenOutlined,
  FileProtectOutlined,
  SwapOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SettingOutlined,
  TeamOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons'
import { PERMISSIONS } from './permissions'

export const navigationItems = [
  { key: '/', path: '/', icon: <DashboardOutlined />, label: '★ 仪表盘', title: '★ 仪表盘', subtitle: '生产环境实时态势、资源水位和服务健康概览', permission: PERMISSIONS.DASHBOARD_VIEW },
  { key: '/alerts', path: '/alerts', icon: <AlertOutlined />, label: '★ 告警中心', title: '★ 告警中心', subtitle: '集中处理告警并辅助定位故障根因', permission: PERMISSIONS.ALERTS_VIEW },
  { key: '/hosts', path: '/hosts', icon: <CloudServerOutlined />, label: '★ 主机管理', title: '★ 主机管理', subtitle: '统一管理主机纳管、Agent 生命周期、资源趋势和审计日志', permission: PERMISSIONS.HOSTS_VIEW },
  { key: '/logs', path: '/logs', icon: <FileSearchOutlined />, label: '★ 日志查询', title: '★ 日志查询', subtitle: '按关键字、服务和级别检索日志数据', permission: PERMISSIONS.LOGS_VIEW },
  { key: '/log-monitoring', path: '/log-monitoring', icon: <FundProjectionScreenOutlined />, label: '★ 日志监控', title: '★ 日志监控', subtitle: '按关键字次数、周期、节假日和时间段触发告警', permission: PERMISSIONS.LOGS_VIEW },
  { key: '/ssl-certificates', path: '/ssl-certificates', icon: <SafetyCertificateOutlined />, label: '★ SSL证书监控', title: '★ SSL证书监控', subtitle: '监控域名证书有效期、域名匹配和到期告警', permission: PERMISSIONS.SSL_CERTIFICATES_VIEW },
  { key: '/batch-jobs', path: '/batch-jobs', icon: <DeploymentUnitOutlined />, label: '★ 批处理', title: '★ 批处理', subtitle: '批量上传文件、执行脚本并查看执行记录和日志', permission: PERMISSIONS.BATCH_VIEW },
  { key: '/self-healing', path: '/self-healing', icon: <ThunderboltOutlined />, label: '★ 自愈规则', title: '★ 自愈规则', subtitle: '配置故障自愈条件、动作和执行历史', permission: PERMISSIONS.SELF_HEALING_VIEW },
  { key: '/audit-logs', path: '/audit-logs', icon: <FileProtectOutlined />, label: '★ 审计日志中心', title: '★ 审计日志中心', subtitle: '集中查询、校验和导出平台审计日志', permission: PERMISSIONS.AUDIT_LOG_VIEW },
  { key: '/accounts', path: '/accounts', icon: <TeamOutlined />, label: '★ 账号权限', title: '★ 账号权限', subtitle: '管理平台账号、角色和权限分配', permission: PERMISSIONS.ACCOUNTS_MANAGE },
  { key: '/ai', path: '/ai', icon: <RobotOutlined />, label: '★ AI 助手', title: '★ AI 助手', subtitle: '面向运维场景的对话式分析助手', permission: PERMISSIONS.AI_VIEW },
  { key: '/topology', path: '/topology', icon: <ClusterOutlined />, label: '服务拓扑', title: '服务拓扑', subtitle: '手动画主机、服务、依赖和备注，沉淀静态架构图', permission: PERMISSIONS.TOPOLOGY_VIEW },
  { key: '/alert-handling', path: '/alert-handling', icon: <BellOutlined />, label: '告警自动处理', title: '告警自动处理', subtitle: '将外部告警映射到安全模式自愈规则', permission: PERMISSIONS.ALERT_HANDLING_VIEW },
  { key: '/inspection', path: '/inspection', icon: <SafetyCertificateOutlined />, label: '智能巡检', title: '智能巡检', subtitle: '通过自然语言描述生成巡检计划和结果', permission: PERMISSIONS.INSPECTION_VIEW },
  { key: '/xm2-convert', path: '/xm2-convert', icon: <SwapOutlined />, label: 'xm2 转换', title: 'xm2 转换', subtitle: '将旧 monitor.json 中的日志内容监控转换为平台日志监控规则', permission: PERMISSIONS.LOGS_MANAGE },
  { key: '/settings', path: '/settings', icon: <SettingOutlined />, label: '★ 设置', title: '★ 设置', subtitle: '平台偏好、主题和数据源信息', permission: PERMISSIONS.SETTINGS_VIEW },
]

const hostDetailMeta = {
  title: '主机详情',
  subtitle: '查看主机完整信息、Agent 状态、资源趋势和操作记录',
  permission: PERMISSIONS.HOSTS_VIEW,
}

const forbiddenMeta = {
  title: '权限不足',
  subtitle: '当前账号没有访问该页面或操作的权限',
}

export function getPageMeta(pathname) {
  if (pathname.startsWith('/hosts/')) return hostDetailMeta
  if (pathname === '/403') return forbiddenMeta
  return navigationItems.find((item) => item.path === pathname) ?? navigationItems[0]
}
