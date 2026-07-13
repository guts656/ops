import {
  AlertOutlined,
  ApiOutlined,
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudServerOutlined,
  DashboardOutlined,
  ForkOutlined,
  HeartOutlined,
  MinusOutlined,
  PlayCircleOutlined,
  SafetyOutlined,
  ThunderboltOutlined,
  WarningOutlined,
} from '@ant-design/icons'
import { Alert, Button, Card, Col, Empty, Progress, Row, Skeleton, Space, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getDashboardData } from '../api/dashboard'
import AlertList from '../components/AlertList'

const statConfig = [
  { key: 'health', title: '系统健康度', icon: HeartOutlined, color: '#52c41a', bg: '#f6ffed' },
  { key: 'alerts', title: '今日告警', icon: AlertOutlined, color: '#ff4d4f', bg: '#fff2f0' },
  { key: 'services', title: '服务可用性', icon: ApiOutlined, color: '#faad14', bg: '#fffbe6' },
  { key: 'availability', title: '可用性', icon: DashboardOutlined, color: '#1677ff', bg: '#e6f4ff' },
  { key: 'batchJobs', title: '批处理任务', icon: ForkOutlined, color: '#722ed1', bg: '#f9f0ff' },
]

const quickActions = [
  { name: '系统巡检', description: '快速检查服务器状态', icon: SafetyOutlined, color: '#1677ff', bg: '#e6f4ff', path: '/inspection' },
  { name: '执行批处理', description: '批量上传文件或执行脚本', icon: ThunderboltOutlined, color: '#722ed1', bg: '#f9f0ff', path: '/batch-jobs' },
  { name: '查看告警', description: '查看最新系统告警', icon: AlertOutlined, color: '#ff4d4f', bg: '#fff2f0', path: '/alerts' },
  { name: '服务拓扑', description: '维护静态服务架构图', icon: CloudServerOutlined, color: '#13c2c2', bg: '#e6fffb', path: '/topology' },
]

function AlertTrendChart({ data = [] }) {
  const width = 640
  const height = 220
  const padding = 28
  const max = Math.max(...data.map((item) => item.value), 1)
  const points = data.map((item, index) => {
    const x = padding + (index * (width - padding * 2)) / Math.max(data.length - 1, 1)
    const y = height - padding - (item.value / max) * (height - padding * 2)
    return { ...item, x, y }
  })
  const polyline = points.map((point) => `${point.x},${point.y}`).join(' ')

  return (
    <div className="trend-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="近 7 天告警趋势图">
        {[0, 1, 2, 3].map((line) => {
          const y = padding + (line * (height - padding * 2)) / 3
          return <line key={line} x1={padding} x2={width - padding} y1={y} y2={y} stroke="rgba(255,255,255,.08)" />
        })}
        <polyline points={polyline} fill="none" stroke="#1677ff" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
        {points.map((point) => (
          <g key={point.date}>
            <circle cx={point.x} cy={point.y} r="5" fill="#1677ff" stroke="#141414" strokeWidth="3" />
            <text x={point.x} y={height - 6} textAnchor="middle" fill="#8c8c8c" fontSize="12">
              {point.date}
            </text>
            <text x={point.x} y={point.y - 12} textAnchor="middle" fill="#d9d9d9" fontSize="12">
              {point.value}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function TrendIcon({ trendType }) {
  if (trendType === 'up') return <ArrowUpOutlined style={{ color: '#52c41a' }} />
  if (trendType === 'danger') return <ArrowDownOutlined style={{ color: '#ff4d4f' }} />
  return <MinusOutlined style={{ color: '#8c8c8c' }} />
}

function StatusTag({ status }) {
  const config = {
    success: { color: 'success', text: '成功' },
    failed: { color: 'error', text: '失败' },
    partial: { color: 'warning', text: '部分成功' },
    running: { color: 'processing', text: '运行中' },
    completed: { color: 'success', text: '完成' },
    pending: { color: 'default', text: '等待中' },
    高: { color: 'error', text: '高风险' },
    中: { color: 'warning', text: '中风险' },
    低: { color: 'success', text: '低风险' },
    在线: { color: 'success', text: '在线' },
    离线: { color: 'error', text: '离线' },
  }
  const c = config[status] || { color: 'default', text: status }
  return <Tag color={c.color}>{c.text}</Tag>
}

function serviceStatusColor(status) {
  if (status === '健康') return 'success'
  if (status === '警告') return 'warning'
  return 'error'
}

function serviceProgressStatus(score = 0) {
  if (score >= 90) return 'success'
  if (score >= 70) return 'normal'
  return 'exception'
}

function instanceStatusTag(status, bucket) {
  const color = bucket === 'healthy' ? 'success' : bucket === 'warning' ? 'warning' : bucket === 'abnormal' ? 'error' : 'default'
  return <Tag color={color}>{status || 'unknown'}</Tag>
}

function serviceUrl(path, service, extra = '') {
  const query = `service=${encodeURIComponent(service)}`
  return `${path}?${query}${extra}`
}

export default function Dashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const navigate = useNavigate()

  const loadDashboard = useCallback(() => {
    setLoading(true)
    setError('')
    getDashboardData()
      .then((res) => {
        setData(res)
      })
      .catch((err) => {
        setError(err?.response?.data?.message || err?.message || '仪表盘数据加载失败')
      })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    void Promise.resolve().then(loadDashboard)
  }, [loadDashboard])

  const stats = useMemo(() => {
    if (!data) return []
    return statConfig.map((cfg) => {
      const metric = data.metrics.find((m) => m.key === cfg.key)
      return { ...cfg, ...metric }
    })
  }, [data])

  const openServiceAlerts = useCallback((service) => {
    navigate(serviceUrl('/alerts', service, '&active=true'))
  }, [navigate])

  const openServiceLogs = useCallback((service, hostId) => {
    navigate(serviceUrl('/logs', service, hostId ? `&hostId=${encodeURIComponent(hostId)}` : ''))
  }, [navigate])

  const batchColumns = [
    { title: '任务名称', dataIndex: 'name', ellipsis: true },
    { title: '状态', dataIndex: 'status', width: 90, render: (v) => <StatusTag status={v} /> },
    { title: '目标', width: 90, render: (_, r) => `${r.successCount}/${r.targetCount}` },
    { title: '时间', dataIndex: 'startedAt', width: 160 },
  ]

  const selfHealingColumns = [
    { title: '规则', dataIndex: 'ruleName', ellipsis: true },
    { title: '服务', dataIndex: 'service', width: 120 },
    { title: '状态', dataIndex: 'status', width: 90, render: (v) => <StatusTag status={v} /> },
    { title: '耗时', dataIndex: 'duration', width: 90 },
  ]

  const hostColumns = [
    {
      title: '主机',
      render: (_, h) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{h.hostname}</Typography.Text>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {h.ip}
          </Typography.Text>
        </Space>
      ),
    },
    { title: '状态', dataIndex: 'status', width: 80, render: (v) => <StatusTag status={v} /> },
  ]

  const serviceHealth = data?.serviceHealth || {}

  const serviceSummaryItems = [
    { label: '服务名', value: serviceHealth.uniqueServiceNameCount ?? 0, color: 'blue' },
    { label: '上传服务实例', value: serviceHealth.uploadedServiceInstanceCount ?? 0, color: 'green' },
    { label: '容器实例', value: serviceHealth.containerInstanceCount ?? 0, color: 'purple' },
    { label: '聚合项', value: serviceHealth.aggregateNameCount ?? 0, color: 'gold' },
  ]

  const renderInstanceAvailability = (record) => {
    const serviceTotal = record.serviceInstanceCount ?? 0
    const containerTotal = record.containerInstanceCount ?? 0
    return (
      <Space direction="vertical" size={0}>
        <Typography.Text strong>{record.healthyInstances ?? 0}/{record.instances ?? 0}</Typography.Text>
        <Typography.Text type={serviceTotal ? undefined : 'secondary'} style={{ fontSize: 12 }}>
          服务 {record.healthyServiceInstanceCount ?? 0}/{serviceTotal}
        </Typography.Text>
        <Typography.Text type={containerTotal ? undefined : 'secondary'} style={{ fontSize: 12 }}>
          容器 {record.healthyContainerInstanceCount ?? 0}/{containerTotal}
        </Typography.Text>
      </Space>
    )
  }

  const serviceColumns = [
    {
      title: '服务',
      dataIndex: 'name',
      fixed: 'left',
      width: 170,
      ellipsis: true,
      render: (name) => <Typography.Text strong>{name}</Typography.Text>,
    },
    {
      title: '健康度',
      dataIndex: 'healthScore',
      width: 150,
      render: (score = 0) => (
        <Space direction="vertical" size={0} style={{ width: 120 }}>
          <Progress percent={Math.round(score)} size="small" status={serviceProgressStatus(score)} />
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>{score}%</Typography.Text>
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      render: (v) => <Tag color={serviceStatusColor(v)}>{v}</Tag>,
    },
    {
      title: '实例可用性',
      width: 130,
      render: (_, r) => renderInstanceAvailability(r),
    },
    { title: '受影响主机', dataIndex: 'affectedHosts', width: 110 },
    {
      title: '未解决告警',
      dataIndex: 'activeAlerts',
      width: 120,
      render: (count, r) => count ? <Button type="link" size="small" onClick={() => openServiceAlerts(r.name)}>{count} 条</Button> : <Typography.Text type="secondary">0</Typography.Text>,
    },
    {
      title: '日志/状态告警',
      width: 140,
      render: (_, r) => `日志 ${r.logAlerts ?? 0} / 状态 ${r.statusAlerts ?? 0}`,
    },
    { title: '今日错误日志', dataIndex: 'errorLogsToday', width: 120 },
    {
      title: '操作',
      width: 160,
      render: (_, r) => (
        <Space size={4}>
          <Button size="small" onClick={() => openServiceAlerts(r.name)}>告警</Button>
          <Button size="small" onClick={() => openServiceLogs(r.name)}>日志</Button>
        </Space>
      ),
    },
  ]

  const serviceHostColumns = (serviceName) => [
    {
      title: '主机',
      render: (_, h) => (
        <Button type="link" size="small" onClick={() => navigate(`/hosts/${h.hostId}`)}>
          {h.hostname || h.ip}
        </Button>
      ),
    },
    { title: 'IP', dataIndex: 'ip', width: 150 },
    { title: '实例状态', width: 120, render: (_, h) => instanceStatusTag(h.status, h.statusBucket) },
    { title: '类型', dataIndex: 'kind', width: 90, render: (kind) => kind === 'container' ? '容器' : '服务' },
    { title: '端口', dataIndex: 'port', width: 80, render: (port) => port || '-' },
    { title: '来源', dataIndex: 'source', width: 120, ellipsis: true },
    { title: '最后上报', dataIndex: 'lastReportedAt', width: 180 },
    { title: '告警', dataIndex: 'activeAlerts', width: 80 },
    {
      title: '操作',
      width: 90,
      render: (_, h) => <Button size="small" onClick={() => openServiceLogs(serviceName, h.hostId)}>日志</Button>,
    },
  ]

  return (
    <Space className="dashboard-page" direction="vertical" size="large" style={{ width: '100%' }}>
      {error && (
        <Alert
          type="error"
          showIcon
          message="仪表盘数据加载失败"
          description={error}
          action={<Button size="small" danger onClick={loadDashboard}>重试</Button>}
        />
      )}
      {/* 统计卡片 */}
      {loading ? (
        <Row gutter={[16, 16]}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Col xs={24} sm={12} xl={8} key={i}>
              <Card>
                <Skeleton active paragraph={{ rows: 2 }} />
              </Card>
            </Col>
          ))}
        </Row>
      ) : (
        <Row gutter={[16, 16]}>
          {stats.map((stat) => (
            <Col xs={24} sm={12} xl={8} key={stat.key}>
              <Card
                className="dashboard-stat-card"
                styles={{ body: { padding: 20 } }}
                hoverable
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: 10,
                      background: stat.bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <stat.icon style={{ fontSize: 22, color: stat.color }} />
                  </div>
                  <TrendIcon trendType={stat.trendType} />
                </div>
                <div style={{ fontSize: 28, fontWeight: 700, color: '#f6f9ff', marginBottom: 4 }}>{stat.value}</div>
                <div style={{ fontSize: 13, color: '#b8c4dc' }}>{stat.title}</div>
                <Tag
                  style={{ marginTop: 8, fontSize: 12 }}
                  color={stat.trendType === 'danger' ? 'error' : stat.trendType === 'warning' ? 'warning' : stat.trendType === 'up' ? 'success' : 'default'}
                  icon={stat.trendType === 'danger' ? <WarningOutlined /> : null}
                >
                  {stat.trend}
                </Tag>
              </Card>
            </Col>
          ))}
        </Row>
      )}

      {/* 资源监控 + 告警趋势 */}
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card title="资源监控" loading={loading}>
            <Space direction="vertical" size="large" style={{ width: '100%' }}>
              {(data?.resources || []).map((resource) => (
                <div key={resource.name}>
                  <div className="resource-label">
                    <Typography.Text>{resource.name}</Typography.Text>
                    <Typography.Text strong>{resource.value}%</Typography.Text>
                  </div>
                  <Progress percent={resource.value} status={resource.status} />
                </div>
              ))}
            </Space>
          </Card>
        </Col>
        <Col xs={24} xl={16}>
          <Card title="近 7 天告警趋势" loading={loading}>
            {data?.alertTrend?.length > 0 ? (
              <AlertTrendChart data={data.alertTrend} />
            ) : (
              <Empty description="暂无告警数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>

      {/* 快捷操作 */}
      <Card title="一键执行" loading={loading}>
        <Row gutter={[16, 16]}>
          {quickActions.map((action) => (
            <Col xs={24} sm={12} md={6} key={action.name}>
              <Button
                type="text"
                block
                style={{
                  height: 'auto',
                  padding: '16px',
                  textAlign: 'left',
                  borderRadius: 10,
                  border: '1px solid #f0f0f0',
                }}
                onClick={() => navigate(action.path)}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = action.color
                  e.currentTarget.style.boxShadow = `0 2px 8px ${action.color}20`
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = '#f0f0f0'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <Space direction="vertical" size="small" align="start">
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: action.bg,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'transform 0.2s',
                    }}
                  >
                    <action.icon style={{ fontSize: 20, color: action.color }} />
                  </div>
                  <Typography.Text strong style={{ fontSize: 15 }}>
                    {action.name}
                  </Typography.Text>
                  <Typography.Text type="secondary" style={{ fontSize: 12, whiteSpace: 'normal' }}>
                    {action.description}
                  </Typography.Text>
                </Space>
              </Button>
            </Col>
          ))}
        </Row>
      </Card>

      {/* 多列信息面板 */}
      <Row gutter={[16, 16]}>
        {/* 主机列表 */}
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space>
                <CloudServerOutlined style={{ color: '#722ed1' }} />
                主机状态
              </Space>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigate('/hosts')}>
                查看全部
              </Button>
            }
            loading={loading}
          >
            {data?.hosts?.length > 0 ? (
              <Table
                dataSource={data.hosts.slice(0, 6)}
                columns={hostColumns}
                rowKey="id"
                pagination={false}
                size="small"
                showHeader={false}
              />
            ) : (
              <Empty description="暂无主机" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Button type="primary" size="small" onClick={() => navigate('/hosts')}>
                  添加主机
                </Button>
              </Empty>
            )}
          </Card>
        </Col>

        {/* 最近批处理 */}
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space>
                <ForkOutlined style={{ color: '#722ed1' }} />
                最近批处理
              </Space>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigate('/batch-jobs')}>
                查看全部
              </Button>
            }
            loading={loading}
          >
            {data?.recentBatchJobs?.length > 0 ? (
              <Table
                dataSource={data.recentBatchJobs}
                columns={batchColumns}
                rowKey="id"
                pagination={false}
                size="small"
              />
            ) : (
              <Empty description="暂无批处理任务" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Button type="primary" size="small" onClick={() => navigate('/batch-jobs')}>
                  新建批处理
                </Button>
              </Empty>
            )}
          </Card>
        </Col>

        {/* 最近告警 */}
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space>
                <AlertOutlined style={{ color: '#ff4d4f' }} />
                最新告警
              </Space>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigate('/alerts')}>
                查看全部
              </Button>
            }
            loading={loading}
          >
            {data?.alerts?.length > 0 ? (
              <AlertList alerts={data.alerts} />
            ) : (
              <Empty description="暂无告警" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Button type="primary" size="small" onClick={() => navigate('/alerts')}>
                  查看告警中心
                </Button>
              </Empty>
            )}
          </Card>
        </Col>

        {/* 最近自愈 */}
        <Col xs={24} lg={8}>
          <Card
            title={
              <Space>
                <HeartOutlined style={{ color: '#52c41a' }} />
                最近自愈执行
              </Space>
            }
            extra={
              <Button type="link" size="small" onClick={() => navigate('/self-healing')}>
                查看全部
              </Button>
            }
            loading={loading}
          >
            {data?.recentSelfHealing?.length > 0 ? (
              <Table
                dataSource={data.recentSelfHealing}
                columns={selfHealingColumns}
                rowKey="id"
                pagination={false}
                size="small"
              />
            ) : (
              <Empty description="暂无自愈执行记录" image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Button type="primary" size="small" onClick={() => navigate('/self-healing')}>
                  配置自愈规则
                </Button>
              </Empty>
            )}
          </Card>
        </Col>

        {/* 服务可用性 */}
        <Col xs={24}>
          <Card
            title={
              <Space>
                <PlayCircleOutlined style={{ color: '#1677ff' }} />
                服务可用性
              </Space>
            }
            extra={<Typography.Text type="secondary">按名称聚合展示可用性；数量区分上传服务实例、容器实例和告警/日志关联项</Typography.Text>}
            loading={loading}
          >
            {data?.services?.length > 0 ? (
              <Space direction="vertical" size="middle" style={{ width: '100%' }}>
                <Space size={[8, 8]} wrap>
                  {serviceSummaryItems.map((item) => (
                    <Tag key={item.label} color={item.color}>{item.label}：{item.value}</Tag>
                  ))}
                </Space>
                <Table
                  dataSource={data.services}
                  columns={serviceColumns}
                  rowKey="key"
                  pagination={{ pageSize: 6, showSizeChanger: false }}
                  size="small"
                  scroll={{ x: 1120 }}
                  expandable={{
                    expandedRowRender: (record) => (
                      <Table
                        dataSource={record.hosts || []}
                        columns={serviceHostColumns(record.name)}
                        rowKey={(row) => `${record.key}-${row.hostId}-${row.kind}-${row.port || 'none'}`}
                        pagination={false}
                        size="small"
                      />
                    ),
                    rowExpandable: (record) => Boolean(record.hosts?.length),
                  }}
                />
              </Space>
            ) : (
              <Empty description="暂无服务数据" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            )}
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
