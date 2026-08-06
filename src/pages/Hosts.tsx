import { CloudServerOutlined, DeleteOutlined, PlusOutlined, ReloadOutlined, TagsOutlined, WarningOutlined, CheckCircleOutlined, ToolOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Col, Form, Input, Modal, Popconfirm, Progress, Row, Segmented, Select, Space, Statistic, Table, Tabs, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useState } from 'react'
import type { Key } from 'react'
import { useNavigate } from 'react-router-dom'
import PermissionGate from '../components/auth/PermissionGate'
import AddHostModal from '../components/AddHostModal'
import HostAuditLogPanel from '../components/hosts/HostAuditLogPanel'
import AgentCredentialModal from '../components/hosts/AgentCredentialModal'
import HostMaintenanceModal from '../components/hosts/HostMaintenanceModal'
import EditHostModal from '../components/hosts/EditHostModal'
import LogCollectionRulePanel from '../components/hosts/LogCollectionRulePanel'
import { PERMISSIONS } from '../config/permissions'
import type { EditHostValues, Host, HostCategory, HostConnectionValues, HostFilters } from '../types/host'
import { useHostStore } from '../stores/hostStore'
import { getHostCategory, hostCategoryColor } from '../utils/hostStatus'
import { formatShanghaiTime } from '../utils/time'

const lifecycleStatusColor = { 在线: 'green', 离线: 'red', 纳管中: 'blue' }
const agentColor = { 正常: 'green', 异常: 'red', 未安装: 'default', 安装中: 'blue' }
type HostCategoryFilter = '全部' | HostCategory

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
    batchDeleteHosts,
    batchSetMaintenance,
    batchUpdateTags,
    batchRestartAgent,
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
  const [selectedRowKeys, setSelectedRowKeys] = useState<Key[]>([])
  const [batchMaintenanceOpen, setBatchMaintenanceOpen] = useState(false)
  const [batchTagsOpen, setBatchTagsOpen] = useState(false)
  const [batchTagMode, setBatchTagMode] = useState<'add' | 'remove'>('add')
  const [batchRestartOpen, setBatchRestartOpen] = useState(false)
  const [batchLoading, setBatchLoading] = useState(false)
  const [batchTagForm] = Form.useForm<{ tags: string[] }>()

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

  const clearSelection = () => setSelectedRowKeys([])

  const submitBatchMaintenance = async (values: Parameters<typeof batchSetMaintenance>[1]) => {
    setBatchLoading(true)
    try {
      const count = await batchSetMaintenance(selectedIds, values)
      message.success(`已将 ${count} 台主机移入维护`)
      setBatchMaintenanceOpen(false)
      clearSelection()
    } finally {
      setBatchLoading(false)
    }
  }

  const submitBatchExitMaintenance = async () => {
    setBatchLoading(true)
    try {
      const count = await batchSetMaintenance(selectedIds, { enabled: false })
      message.success(`已取消 ${count} 台主机维护`)
      clearSelection()
    } finally {
      setBatchLoading(false)
    }
  }

  const submitBatchTags = async (values: { tags: string[] }) => {
    setBatchLoading(true)
    try {
      const count = await batchUpdateTags(selectedIds, values.tags, batchTagMode)
      message.success(batchTagMode === 'add' ? `已为 ${count} 台主机打标签` : `已从 ${count} 台主机移除标签`)
      setBatchTagsOpen(false)
      clearSelection()
    } finally {
      setBatchLoading(false)
    }
  }

  const submitBatchRestartAgent = async (values: HostConnectionValues) => {
    setBatchLoading(true)
    try {
      const count = await batchRestartAgent(selectedIds, values)
      message.success(`已重启 ${count} 台主机 Agent`)
      setBatchRestartOpen(false)
      clearSelection()
    } finally {
      setBatchLoading(false)
    }
  }

  const submitBatchDelete = async () => {
    setBatchLoading(true)
    try {
      const count = await batchDeleteHosts(selectedIds)
      message.success(`已删除 ${count} 台主机`)
      clearSelection()
    } finally {
      setBatchLoading(false)
    }
  }

  const selectedIds = selectedRowKeys.map(String)
  const selectedHosts = hosts.filter((host) => selectedIds.includes(host.id))
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
    { title: 'Agent', dataIndex: 'agentStatus', width: 120, render: (_, record) => <Space direction="vertical" size={0}><Tag color={agentColor[record.agentStatus]}>{record.agentStatus}</Tag><Typography.Text type="secondary">{record.agentVersion}</Typography.Text></Space> },
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

  const batchToolbar = selectedHosts.length ? (
    <Alert
      type="info"
      showIcon
      style={{ marginBottom: 16 }}
      message={(
        <Space wrap>
          <Typography.Text>已选择 {selectedHosts.length} 台主机</Typography.Text>
          <PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}>
            <Button size="small" icon={<ToolOutlined />} onClick={() => setBatchMaintenanceOpen(true)}>移入维护</Button>
            <Button size="small" onClick={submitBatchExitMaintenance} loading={batchLoading}>取消维护</Button>
            <Button size="small" icon={<TagsOutlined />} onClick={() => { setBatchTagMode('add'); batchTagForm.resetFields(); setBatchTagsOpen(true) }}>打标签</Button>
            <Button size="small" onClick={() => { setBatchTagMode('remove'); batchTagForm.resetFields(); setBatchTagsOpen(true) }}>移除标签</Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.HOSTS_AGENT}>
            <Button size="small" icon={<ReloadOutlined />} onClick={() => setBatchRestartOpen(true)}>重启 Agent</Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.HOSTS_DELETE}>
            <Popconfirm title="确认批量删除主机？" description={`将删除 ${selectedHosts.length} 台主机，并记录审计日志。`} okText="确认删除" okButtonProps={{ danger: true, loading: batchLoading }} onConfirm={submitBatchDelete}>
              <Button size="small" danger icon={<DeleteOutlined />}>删除主机</Button>
            </Popconfirm>
          </PermissionGate>
          <Button size="small" type="link" onClick={clearSelection}>取消选择</Button>
        </Space>
      )}
    />
  ) : null

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Typography.Title level={3}>主机管理</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>统一管理服务器纳管、Agent 生命周期、资源趋势和合规审计。</Typography.Paragraph>
          </div>
          <PermissionGate permission={PERMISSIONS.HOSTS_MANAGE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAddModal}>新增主机</Button>
          </PermissionGate>
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><Card><Statistic title="主机总数" value={hosts.length} prefix={<CloudServerOutlined />} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="在线主机数" value={onlineCount} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="离线主机数" value={offlineCount} prefix={<WarningOutlined />} valueStyle={{ color: offlineCount ? '#ff4d4f' : '#52c41a' }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="维护主机数" value={maintenanceCount} prefix={<ToolOutlined />} valueStyle={{ color: maintenanceCount ? '#fa8c16' : undefined }} /></Card></Col>
      </Row>

      <Tabs className="hosts-tabs" items={[
        { key: 'list', label: '主机列表', children: <Card className="hosts-list-card" title="主机列表">{filterForm}{batchToolbar}<Segmented<HostCategoryFilter> value={activeCategory} onChange={setActiveCategory} options={['全部', '在线', '离线', '维护']} style={{ marginBottom: 16 }} /><Table className="hosts-table" rowKey="id" loading={loading} columns={columns} dataSource={visibleHosts} pagination={{ pageSize: 6 }} rowSelection={{ selectedRowKeys, onChange: setSelectedRowKeys }} scroll={{ x: 1520 }} /></Card> },
        { key: 'log-rules', label: '日志采集配置', children: <LogCollectionRulePanel hosts={hosts} groups={groups} /> },
        { key: 'audit', label: '审计日志', children: <HostAuditLogPanel logs={auditLogs} /> },
      ]} />

      <AddHostModal open={addModalOpen} groups={groups} tags={tags} batchResults={batchResults} onCancel={closeAddModal} onSubmit={createHosts} onTestConnection={testConnection} />
      <EditHostModal open={Boolean(editingHost)} host={editingHost} groups={groups} tags={tags} loading={editing} onCancel={() => setEditingHost(undefined)} onSubmit={submitEdit} />
      <HostMaintenanceModal open={Boolean(maintenanceHost)} host={maintenanceHost} loading={maintenanceLoading} onCancel={() => setMaintenanceHost(undefined)} onSubmit={submitMaintenance} />
      <HostMaintenanceModal open={batchMaintenanceOpen} host={selectedHosts[0]} title={`批量移入维护：${selectedHosts.length} 台主机`} loading={batchLoading} onCancel={() => setBatchMaintenanceOpen(false)} onSubmit={submitBatchMaintenance} />
      <Modal title={batchTagMode === 'add' ? '批量打标签' : '批量移除标签'} open={batchTagsOpen} onCancel={() => setBatchTagsOpen(false)} onOk={() => batchTagForm.validateFields().then(submitBatchTags)} confirmLoading={batchLoading} destroyOnHidden>
        <Alert showIcon type="info" style={{ marginBottom: 16 }} message={`将对 ${selectedHosts.length} 台主机执行${batchTagMode === 'add' ? '打标签' : '移除标签'}操作。`} />
        <Form form={batchTagForm} layout="vertical">
          <Form.Item name="tags" label="标签" rules={[{ required: true, message: '请选择或输入标签' }]}><Select mode="tags" options={tags.map((value) => ({ label: value, value }))} /></Form.Item>
        </Form>
      </Modal>
      <AgentCredentialModal open={batchRestartOpen} title="批量重启 Agent 凭据" host={selectedHosts[0]} loading={batchLoading} onCancel={() => setBatchRestartOpen(false)} onSubmit={submitBatchRestartAgent} />
    </Space>
  )
}
