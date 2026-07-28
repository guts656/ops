import { CloudServerOutlined, PlusOutlined, WarningOutlined, CheckCircleOutlined, ToolOutlined, SyncOutlined } from '@ant-design/icons'
import { Button, Card, Col, Form, Input, Popconfirm, Progress, Row, Segmented, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import PermissionGate from '../components/auth/PermissionGate'
import AddHostModal from '../components/AddHostModal'
import HostAuditLogPanel from '../components/hosts/HostAuditLogPanel'
import HostMaintenanceModal from '../components/hosts/HostMaintenanceModal'
import EditHostModal from '../components/hosts/EditHostModal'
import LogCollectionRulePanel from '../components/hosts/LogCollectionRulePanel'
import { PERMISSIONS } from '../config/permissions'
import type { EditHostValues, Host, HostCategory, HostFilters } from '../types/host'
import { useHostStore } from '../stores/hostStore'
import { queueAgentUpdateJobs } from '../api/hosts'
import { getHostCategory, hostCategoryColor } from '../utils/hostStatus'
import { formatShanghaiTime } from '../utils/time'

const lifecycleStatusColor = { 在线: 'green', 离线: 'red', 纳管中: 'blue' }
const agentColor = { 正常: 'green', 异常: 'red', 未安装: 'default', 安装中: 'blue' }
type HostCategoryFilter = '全部' | HostCategory

function isOfflineInstallPending(host: Host) {
  return host.os === 'Windows' && host.agentStatus === '安装中' && !host.pullCredential?.enabled
}

export default function Hosts() {
  const navigate = useNavigate()
  const {
    hosts,
    auditLogs,
    groups,
    tags,
    loading,
    addModalOpen,
    batchResults,
    load,
    updateFilters,
    openAddModal,
    closeAddModal,
    testConnection,
    createHosts,
    updateHost,
    deleteHost,
    remanageHost,
    refreshHosts,
    setHostMaintenance,
  } = useHostStore()

  const [editingHost, setEditingHost] = useState<Host>()
  const [maintenanceHost, setMaintenanceHost] = useState<Host>()
  const [maintenanceLoading, setMaintenanceLoading] = useState(false)
  const [editing, setEditing] = useState(false)
  const [remanagingId, setRemanagingId] = useState<string>()
  const [activeCategory, setActiveCategory] = useState<HostCategoryFilter>('全部')
  const [bulkAgentUpdateLoading, setBulkAgentUpdateLoading] = useState(false)

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      void refreshHosts()
    }, 30000)
    return () => window.clearInterval(intervalId)
  }, [refreshHosts])

  const submitEdit = async (values: EditHostValues) => {
    if (!editingHost) return
    setEditing(true)
    try {
      await updateHost(editingHost.id, values)
      message.success('主机信息已更新')
      setEditingHost(undefined)
    } finally {
      setEditing(false)
    }
  }

  const handleRemanage = async (id: string) => {
    setRemanagingId(id)
    try {
      await remanageHost(id)
      message.success('已进入重新纳管状态，请到详情页重新安装 Agent')
    } finally {
      setRemanagingId(undefined)
    }
  }

  const submitMaintenance = async (values: Parameters<typeof setHostMaintenance>[1]) => {
    if (!maintenanceHost) return
    setMaintenanceLoading(true)
    try {
      await setHostMaintenance(maintenanceHost.id, values)
      message.success('主机已进入维护，维护期间不会创建或外发关联告警')
      setMaintenanceHost(undefined)
    } finally {
      setMaintenanceLoading(false)
    }
  }

  const exitMaintenance = async (host: Host) => {
    setMaintenanceLoading(true)
    try {
      await setHostMaintenance(host.id, { enabled: false })
      message.success('主机已退出维护，告警监控已恢复')
    } finally {
      setMaintenanceLoading(false)
    }
  }

  const handleBulkAgentUpdate = async () => {
    setBulkAgentUpdateLoading(true)
    try {
      const result = await queueAgentUpdateJobs({ onlyOutdated: true })
      if (result.queued.length) {
        message.success(`已下发 ${result.queued.length} 台 Agent 更新任务，目标版本 ${result.targetVersion}；跳过 ${result.skipped.length} 台`)
      } else {
        message.info(`未下发更新任务；跳过 ${result.skipped.length} 台。${result.skipped[0]?.reason || ''}`)
      }
      await refreshHosts()
    } finally {
      setBulkAgentUpdateLoading(false)
    }
  }

  const visibleHosts = activeCategory === '全部' ? hosts : hosts.filter((host) => getHostCategory(host) === activeCategory)
  const onlineCount = hosts.filter((host) => getHostCategory(host) === '在线').length
  const offlineCount = hosts.filter((host) => getHostCategory(host) === '离线').length
  const maintenanceCount = hosts.filter((host) => getHostCategory(host) === '维护').length

  const columns: ColumnsType<Host> = [
    { title: 'IP / 主机名', dataIndex: 'ip', width: 172, render: (_, record) => <Space className="host-identity-cell" direction="vertical" size={0}><Typography.Text strong ellipsis>{record.ip}</Typography.Text><Typography.Text type="secondary" ellipsis>{record.hostname}</Typography.Text></Space> },
    { title: '操作系统', dataIndex: 'os', width: 220, render: (_, record) => <Space direction="vertical" size={0}><Typography.Text>{record.os}</Typography.Text><Typography.Text type="secondary" ellipsis>{record.osVersion}</Typography.Text></Space> },
    { title: 'CPU/内存/磁盘', width: 190, render: (_, record) => <Space direction="vertical" size={4} style={{ width: 150 }}><Progress percent={record.cpu} size="small" /><Progress percent={record.memory} size="small" strokeColor="#52c41a" /><Progress percent={record.disk} size="small" strokeColor="#faad14" /></Space> },
    { title: '状态', dataIndex: 'status', width: 110, render: (_, record) => {
      const category = getHostCategory(record)
      return <Space direction="vertical" size={0}><Tag color={hostCategoryColor[category]}>{category}</Tag>{record.status === '纳管中' ? <Tag color={lifecycleStatusColor[record.status]}>纳管中</Tag> : null}</Space>
    } },
    { title: 'Agent', dataIndex: 'agentStatus', width: 140, render: (_, record) => {
      const offlinePending = isOfflineInstallPending(record)
      return <Space direction="vertical" size={0}><Tag color={offlinePending ? 'gold' : agentColor[record.agentStatus]}>{offlinePending ? '待离线安装' : record.agentStatus}</Tag><Typography.Text type="secondary">{record.agentVersion}</Typography.Text></Space>
    } },
    { title: '标签', dataIndex: 'tags', width: 220, render: (values) => <Space size={[0, 4]} wrap>{values.map((tag: string) => <Tag key={tag}>{tag}</Tag>)}</Space> },
    { title: '主机组', dataIndex: 'group', width: 150, ellipsis: true },
    { title: '最后心跳', dataIndex: 'lastHeartbeat', width: 170, render: (value) => formatShanghaiTime(value) },
    { title: '操作', width: 320, fixed: 'right', render: (_, record) => <Space className="host-table-actions"><Button type="link" onClick={() => navigate(`/hosts/${record.id}`)}>详情</Button><PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}><Button type="link" onClick={() => setEditingHost(record)}>编辑</Button></PermissionGate><PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}>{record.maintenance.active ? <Button type="link" loading={maintenanceLoading} onClick={() => exitMaintenance(record)}>退出维护</Button> : <Button type="link" onClick={() => setMaintenanceHost(record)}>进入维护</Button>}</PermissionGate><PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}><Button type="link" loading={remanagingId === record.id} onClick={() => handleRemanage(record.id)}>重新纳管</Button></PermissionGate><PermissionGate permission={PERMISSIONS.HOSTS_DELETE}><Popconfirm title="确认删除该主机？" description="删除后会记录审计日志。" onConfirm={() => deleteHost(record.id)}><Button type="link" danger>删除</Button></Popconfirm></PermissionGate></Space> },
  ]

  const filterForm = (
    <Form layout="inline" className="hosts-filter-form" onFinish={(values: HostFilters) => updateFilters(values)}>
      <Form.Item name="keyword"><Input allowClear placeholder="搜索 IP / 主机名" /></Form.Item>
      <Form.Item name="tag"><Select allowClear placeholder="标签" options={tags.map((value) => ({ label: value, value }))} /></Form.Item>
      <Form.Item name="group"><Select allowClear placeholder="主机组" options={groups.map((value) => ({ label: value, value }))} /></Form.Item>
      <Form.Item><Space><Button type="primary" htmlType="submit">筛选</Button><Button onClick={() => updateFilters({})}>重置</Button></Space></Form.Item>
    </Form>
  )

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Typography.Title level={3}>主机管理</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>统一管理服务器纳管、Agent 生命周期、资源趋势和合规审计。</Typography.Paragraph>
          </div>
          <Space wrap>
            <PermissionGate permission={PERMISSIONS.HOSTS_AGENT}>
              <Popconfirm
                title="批量更新 Agent？"
                description="只会给在线且支持自更新的 Agent 下发任务；低版本 Agent 会跳过并提示原因。"
                onConfirm={handleBulkAgentUpdate}
              >
                <Button icon={<SyncOutlined />} loading={bulkAgentUpdateLoading}>批量更新 Agent</Button>
              </Popconfirm>
            </PermissionGate>
            <PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}>
              <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>新增主机</Button>
            </PermissionGate>
          </Space>
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><Card><Statistic title="主机总数" value={hosts.length} prefix={<CloudServerOutlined />} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="在线主机数" value={onlineCount} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="离线主机数" value={offlineCount} prefix={<WarningOutlined />} valueStyle={{ color: offlineCount ? '#ff4d4f' : '#52c41a' }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="维护主机数" value={maintenanceCount} prefix={<ToolOutlined />} valueStyle={{ color: maintenanceCount ? '#fa8c16' : undefined }} /></Card></Col>
      </Row>

      <Tabs className="hosts-tabs" items={[
        { key: 'list', label: '主机列表', children: <Card className="hosts-list-card" title="主机列表">{filterForm}<Segmented<HostCategoryFilter> value={activeCategory} onChange={setActiveCategory} options={['全部', '在线', '离线', '维护']} style={{ marginBottom: 16 }} /><Table className="hosts-table" rowKey="id" loading={loading} columns={columns} dataSource={visibleHosts} pagination={{ pageSize: 6 }} scroll={{ x: 1520 }} /></Card> },
        { key: 'log-rules', label: '日志采集配置', children: <LogCollectionRulePanel hosts={hosts} groups={groups} /> },
        { key: 'audit', label: '审计日志', children: <HostAuditLogPanel logs={auditLogs} /> },
      ]} />

      <AddHostModal open={addModalOpen} groups={groups} tags={tags} batchResults={batchResults} onCancel={closeAddModal} onSubmit={createHosts} onTestConnection={testConnection} />
      <EditHostModal open={Boolean(editingHost)} host={editingHost} groups={groups} tags={tags} loading={editing} onCancel={() => setEditingHost(undefined)} onSubmit={submitEdit} />
      <HostMaintenanceModal open={Boolean(maintenanceHost)} host={maintenanceHost} loading={maintenanceLoading} onCancel={() => setMaintenanceHost(undefined)} onSubmit={submitMaintenance} />
    </Space>
  )
}
