import { ArrowLeftOutlined, DeleteOutlined, ReloadOutlined, ToolOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Descriptions, Empty, Flex, Popconfirm, Progress, Row, Space, Spin, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import PermissionGate from '../components/auth/PermissionGate'
import AgentCredentialModal from '../components/hosts/AgentCredentialModal'
import AgentJobPanel from '../components/hosts/AgentJobPanel'
import HostAuditLogPanel from '../components/hosts/HostAuditLogPanel'
import HostContainerPanel from '../components/hosts/HostContainerPanel'
import HostMaintenanceModal from '../components/hosts/HostMaintenanceModal'
import HostResourceTrend from '../components/hosts/HostResourceTrend'
import HostServiceEventPanel from '../components/hosts/HostServiceEventPanel'
import HostServicePanel from '../components/hosts/HostServicePanel'
import { getErrorMessage } from '../api/http'
import { PERMISSIONS } from '../config/permissions'
import { useHostStore } from '../stores/hostStore'
import type { HostServiceItem } from '../types/service'
import { getHostCategory, hostCategoryColor } from '../utils/hostStatus'
import { formatShanghaiTime } from '../utils/time'

const lifecycleStatusColor = { 在线: 'green', 离线: 'red', 纳管中: 'blue' }
const agentColor = { 正常: 'green', 异常: 'red', 未安装: 'default', 安装中: 'blue' }

function valueOrDash(value?: string | number | null) {
  return value || value === 0 ? value : '-'
}

function formatTime(value?: string) {
  return formatShanghaiTime(value)
}

function formatUptime(seconds?: number) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return '-'
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时 ${minutes} 分钟`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${minutes} 分钟`
}

export default function HostDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { selectedHost, resourceTrend, auditLogs, agentJobs, hostServices, hostContainers, serviceEvents, hostLogs, detailLoading, loadHostDetail, refreshHostMetrics, deleteHost, remanageHost, setHostMaintenance, refreshHostInfo, pullHostMetrics, saveHostPullCredential, disableHostPullCredential, reinstallAgent, restartAgent, startService, stopService, deleteServiceRecord } = useHostStore()
  const [credentialAction, setCredentialAction] = useState<'refreshInfo' | 'pullMetrics' | 'autoPull' | 'reinstall' | 'restart' | 'startService' | 'stopService' | null>(null)
  const [selectedService, setSelectedService] = useState<HostServiceItem>()
  const [credentialLoading, setCredentialLoading] = useState(false)
  const [maintenanceOpen, setMaintenanceOpen] = useState(false)
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)

  useEffect(() => {
    if (id) loadHostDetail(id)
  }, [id, loadHostDetail])

  useEffect(() => {
    if (!id) return undefined
    const intervalId = window.setInterval(() => {
      void refreshHostMetrics(id)
    }, 30000)
    return () => window.clearInterval(intervalId)
  }, [id, refreshHostMetrics])

  if (detailLoading) return <Spin />

  if (!selectedHost) {
    return <Card><Empty description="未找到主机"><Button onClick={() => navigate('/hosts')}>返回主机列表</Button></Empty></Card>
  }

  const hostAuditLogs = auditLogs.filter((log) => log.target === selectedHost.hostname || log.target.includes(selectedHost.ip) || log.detail.includes(selectedHost.hostname))
  const transport = selectedHost.os === 'Windows' ? 'WinRM' : 'SSH'
  const showOrdinaryServices = selectedHost.os !== 'Linux'
  const hostCategory = getHostCategory(selectedHost)

  async function submitCredentials(values: Parameters<typeof reinstallAgent>[1]) {
    if (!selectedHost || !credentialAction) return
    setCredentialLoading(true)
    try {
      if (credentialAction === 'refreshInfo') {
        await refreshHostInfo(selectedHost.id, values)
        message.success('主机信息已刷新')
      }
      if (credentialAction === 'pullMetrics') {
        await pullHostMetrics(selectedHost.id, values)
        message.success(`已通过 ${transport} 拉取主机指标`)
      }
      if (credentialAction === 'autoPull') {
        await saveHostPullCredential(selectedHost.id, values)
        message.success('已加密保存凭据并启用 30 秒自动 Pull')
      }
      if (credentialAction === 'reinstall') {
        await reinstallAgent(selectedHost.id, values)
        message.success('Agent 安装任务已完成，请查看下方任务日志确认状态')
      }
      if (credentialAction === 'restart') {
        await restartAgent(selectedHost.id, values)
        message.success('Agent 重启任务已完成')
      }
      if (credentialAction === 'startService' && selectedService) {
        await startService(selectedHost.id, selectedService.id, values)
        message.success('服务启动命令已执行，请查看服务状态和任务日志')
      }
      if (credentialAction === 'stopService' && selectedService) {
        await stopService(selectedHost.id, selectedService.id, values)
        message.success('服务停止命令已执行，请查看服务状态和任务日志')
      }
      setCredentialAction(null)
      setSelectedService(undefined)
      if (selectedHost?.id) await loadHostDetail(selectedHost.id)
    } catch (error) {
      message.error(getErrorMessage(error, '操作失败，请查看 Agent 任务日志'))
      if (selectedHost?.id) await loadHostDetail(selectedHost.id)
    } finally {
      setCredentialLoading(false)
    }
  }

  function serviceCredentialAction(action: 'startService' | 'stopService', service: HostServiceItem) {
    setSelectedService(service)
    setCredentialAction(action)
  }

  async function submitMaintenance(values: Parameters<typeof setHostMaintenance>[1]) {
    if (!selectedHost) return
    setMaintenanceLoading(true)
    try {
      await setHostMaintenance(selectedHost.id, values)
      message.success('主机已进入维护，维护期间不会创建或外发关联告警')
      setMaintenanceOpen(false)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  async function exitMaintenance() {
    if (!selectedHost) return
    setMaintenanceLoading(true)
    try {
      await setHostMaintenance(selectedHost.id, { enabled: false })
      message.success('主机已退出维护，告警监控已恢复')
    } finally {
      setMaintenanceLoading(false)
    }
  }

  return (
    <Flex vertical gap="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <Space>
            <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/hosts')}>返回</Button>
            <div>
              <Typography.Title level={3} style={{ marginBottom: 0 }}>{selectedHost.hostname}</Typography.Title>
              <Typography.Text type="secondary">{selectedHost.ip}:{selectedHost.sshPort} · {selectedHost.group}</Typography.Text>
            </div>
            <Tag color={hostCategoryColor[hostCategory]}>{hostCategory}</Tag>
            {selectedHost.status === '纳管中' ? <Tag color={lifecycleStatusColor[selectedHost.status]}>纳管中</Tag> : null}
          </Space>
          <Space wrap>
            <PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}>
              <Button icon={<ReloadOutlined />} onClick={() => setCredentialAction('refreshInfo')}>刷新主机信息</Button>
            </PermissionGate>
            <PermissionGate permission={PERMISSIONS.HOSTS_AGENT}>
              <Button onClick={() => setCredentialAction('pullMetrics')}>拉取指标</Button>
            </PermissionGate>
            <PermissionGate permission={PERMISSIONS.HOSTS_AGENT}>
              <Button onClick={() => setCredentialAction('autoPull')}>{selectedHost.pullCredential?.enabled ? '更新自动 Pull 凭据' : '启用自动 Pull'}</Button>
            </PermissionGate>
            {selectedHost.pullCredential?.enabled ? (
              <PermissionGate permission={PERMISSIONS.HOSTS_AGENT}>
                <Button onClick={async () => {
                  await disableHostPullCredential(selectedHost.id)
                  message.success('已停用自动 Pull')
                }}>停用自动 Pull</Button>
              </PermissionGate>
            ) : null}
            <PermissionGate permission={PERMISSIONS.HOSTS_AGENT}>
              <Button icon={<ToolOutlined />} onClick={() => setCredentialAction('reinstall')}>重新安装 Agent</Button>
            </PermissionGate>
            <PermissionGate permission={PERMISSIONS.HOSTS_AGENT}>
              <Button icon={<ReloadOutlined />} onClick={() => setCredentialAction('restart')}>重启 Agent</Button>
            </PermissionGate>
            <PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}>
              {selectedHost.maintenance.active ? <Button loading={maintenanceLoading} onClick={exitMaintenance}>退出维护</Button> : <Button onClick={() => setMaintenanceOpen(true)}>进入维护</Button>}
            </PermissionGate>
            <PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}>
              <Button onClick={() => remanageHost(selectedHost.id)}>重新纳管</Button>
            </PermissionGate>
            <PermissionGate permission={PERMISSIONS.HOSTS_DELETE}>
              <Popconfirm title="确认删除该主机？" description="删除后会返回主机列表，并记录审计日志。" onConfirm={async () => { await deleteHost(selectedHost.id); navigate('/hosts') }}>
                <Button danger icon={<DeleteOutlined />}>删除主机</Button>
              </Popconfirm>
            </PermissionGate>
          </Space>
        </div>
      </Card>

      {selectedHost.maintenance.active ? (
        <Alert
          showIcon
          type="warning"
          message="主机维护中：关联告警不会创建或外发"
          description={`${selectedHost.maintenance.reason || '未填写原因'}${selectedHost.maintenance.until ? `；截止 ${new Date(selectedHost.maintenance.until).toLocaleString('zh-CN', { hour12: false })}` : '；手动结束'}`}
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="主机完整信息">
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="主机 ID">{selectedHost.id}</Descriptions.Item>
              <Descriptions.Item label="IP 地址">{selectedHost.ip}</Descriptions.Item>
              <Descriptions.Item label="主机名">{selectedHost.hostname}</Descriptions.Item>
              <Descriptions.Item label="系统类型"><Tag color={selectedHost.os === 'Windows' ? 'blue' : 'green'}>{selectedHost.os}</Tag></Descriptions.Item>
              <Descriptions.Item label="系统版本">{valueOrDash(selectedHost.osVersion)}</Descriptions.Item>
              <Descriptions.Item label="远程协议">{transport}</Descriptions.Item>
              <Descriptions.Item label="持续运行时间">{selectedHost.status === '在线' ? formatUptime(selectedHost.uptimeSeconds) : '主机离线，等待下次上报'}</Descriptions.Item>
              <Descriptions.Item label={selectedHost.os === 'Windows' ? 'WinRM 端口' : 'SSH 端口'}>{selectedHost.sshPort}</Descriptions.Item>
              <Descriptions.Item label="状态"><Tag color={hostCategoryColor[hostCategory]}>{hostCategory}</Tag></Descriptions.Item>
              <Descriptions.Item label="生命周期状态"><Tag color={lifecycleStatusColor[selectedHost.status]}>{selectedHost.status}</Tag></Descriptions.Item>
              <Descriptions.Item label="主机组">{valueOrDash(selectedHost.group)}</Descriptions.Item>
              <Descriptions.Item label="标签"><Space wrap>{selectedHost.tags.length ? selectedHost.tags.map((tag) => <Tag key={tag}>{tag}</Tag>) : '-'}</Space></Descriptions.Item>
              <Descriptions.Item label="最近心跳">{formatTime(selectedHost.lastHeartbeat)}</Descriptions.Item>
              <Descriptions.Item label="指标快照">CPU {selectedHost.cpu}% / 内存 {selectedHost.memory}% / 磁盘 {selectedHost.disk}%</Descriptions.Item>
              <Descriptions.Item label="系统日志采集">{selectedHost.os === 'Windows' ? '默认采集 Windows System / Application 事件日志' : '默认采集 /var/log/syslog、/var/log/messages 异常日志'}</Descriptions.Item>
              <Descriptions.Item label="维护状态"><Tag color={selectedHost.maintenance.active ? 'orange' : 'default'}>{selectedHost.maintenance.active ? '维护中' : '未维护'}</Tag></Descriptions.Item>
              <Descriptions.Item label="维护说明">{selectedHost.maintenance.active ? `${selectedHost.maintenance.reason || '未填写原因'}${selectedHost.maintenance.until ? `；截止 ${formatTime(selectedHost.maintenance.until)}` : '；手动结束'}` : '-'}</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="Agent 状态">
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="状态"><Tag color={agentColor[selectedHost.agentStatus]}>{selectedHost.agentStatus}</Tag></Descriptions.Item>
              <Descriptions.Item label="版本">{selectedHost.agentVersion}</Descriptions.Item>
              <Descriptions.Item label="安装时间">{formatTime(selectedHost.agentInstalledAt)}</Descriptions.Item>
              <Descriptions.Item label="最后心跳">{formatTime(selectedHost.lastHeartbeat)}</Descriptions.Item>
              <Descriptions.Item label="自动 Pull"><Tag color={selectedHost.pullCredential?.enabled ? 'green' : 'default'}>{selectedHost.pullCredential?.enabled ? '已启用' : '未启用'}</Tag></Descriptions.Item>
              {selectedHost.pullCredential ? (
                <>
                  <Descriptions.Item label={`${transport} 账号`}>{selectedHost.pullCredential.sshUsername}:{selectedHost.pullCredential.sshPort}</Descriptions.Item>
                  <Descriptions.Item label="Pull 间隔">{selectedHost.pullCredential.intervalSeconds} 秒</Descriptions.Item>
                  <Descriptions.Item label="上次 Pull">{formatTime(selectedHost.pullCredential.lastPulledAt)}</Descriptions.Item>
                  <Descriptions.Item label="Pull 错误">{selectedHost.pullCredential.lastError || '-'}</Descriptions.Item>
                </>
              ) : null}
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={8}><Card title="CPU"><Progress percent={selectedHost.cpu} status={selectedHost.cpu > 85 ? 'exception' : 'active'} /></Card></Col>
        <Col xs={24} md={8}><Card title="内存"><Progress percent={selectedHost.memory} strokeColor="#52c41a" status={selectedHost.memory > 85 ? 'exception' : 'active'} /></Card></Col>
        <Col xs={24} md={8}><Card title="磁盘"><Progress percent={selectedHost.disk} strokeColor="#faad14" status={selectedHost.disk > 85 ? 'exception' : 'active'} /></Card></Col>
      </Row>

      <HostResourceTrend data={resourceTrend} />
      {showOrdinaryServices ? (
        <HostServicePanel
          services={hostServices}
          onStart={(service) => serviceCredentialAction('startService', service)}
          onStop={(service) => serviceCredentialAction('stopService', service)}
          onDelete={async (service) => {
            await deleteServiceRecord(selectedHost.id, service.id)
            message.success('已删除平台服务记录；如果 Agent 后续仍上报该服务，记录会重新出现')
          }}
        />
      ) : null}
      <HostContainerPanel containers={hostContainers} />
      {showOrdinaryServices ? <HostServiceEventPanel events={serviceEvents} /> : null}
      <Card title="异常日志">
        <Space>
          <Typography.Text type="secondary">最近已采集 {hostLogs.length} 条异常日志，完整查询和筛选请进入日志查询。</Typography.Text>
          <Button onClick={() => navigate(`/logs?hostId=${selectedHost.id}`)}>去日志查询</Button>
        </Space>
      </Card>
      <AgentJobPanel jobs={agentJobs} />
      <HostAuditLogPanel logs={hostAuditLogs.length ? hostAuditLogs : auditLogs} />
      <HostMaintenanceModal open={maintenanceOpen} host={selectedHost} loading={maintenanceLoading} onCancel={() => setMaintenanceOpen(false)} onSubmit={submitMaintenance} />
      <AgentCredentialModal
        open={Boolean(credentialAction)}
        title={credentialAction === 'refreshInfo' ? '刷新主机信息凭据' : credentialAction === 'pullMetrics' ? '拉取主机指标凭据' : credentialAction === 'autoPull' ? '启用自动 Pull 凭据（加密保存）' : credentialAction === 'restart' ? '重启 Agent 凭据' : credentialAction === 'startService' ? `启动服务：${selectedService?.name || ''}` : credentialAction === 'stopService' ? `停止服务：${selectedService?.name || ''}` : '重新安装 Agent 凭据'}
        host={selectedHost}
        loading={credentialLoading}
        showApiBaseUrl={credentialAction === 'reinstall'}
        onCancel={() => setCredentialAction(null)}
        onSubmit={submitCredentials}
      />
    </Flex>
  )
}
