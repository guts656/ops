import { ApiOutlined, CheckCircleOutlined, ClockCircleOutlined, ExclamationCircleOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Checkbox, Col, Descriptions, Drawer, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../api/http'
import { checkSslCertificateMonitor, createSslCertificateMonitor, deleteSslCertificateMonitor, listSslCertificateHistories, listSslCertificateMonitors, updateSslCertificateMonitor } from '../api/sslCertificates'
import PermissionGate from '../components/auth/PermissionGate'
import { PERMISSIONS } from '../config/permissions'
import type { SslCertificateHistory, SslCertificateMonitor, SslCertificateMonitorInput, SslCertificatePlatformLevel, SslCertificateStatus } from '../types/sslCertificate'
import { formatShanghaiTime } from '../utils/time'

const statusLabels: Record<SslCertificateStatus, string> = {
  normal: '正常',
  expiring: '即将过期',
  expired: '已过期',
  failed: '获取失败',
  unknown: '未检测',
}

const statusColors: Record<SslCertificateStatus, string> = {
  normal: 'green',
  expiring: 'orange',
  expired: 'red',
  failed: 'volcano',
  unknown: 'default',
}

const alertLevelOptions: SslCertificatePlatformLevel[] = ['紧急', '严重', '警告', '提示']
const defaultThresholds = [30, 15, 7]
const thresholdOptions = [100, 80, 60, 30, 15, 7].map((value) => ({ value, label: `到期前 ${value} 天` }))

type FormValues = Omit<SslCertificateMonitorInput, 'notification'> & {
  receivers?: string
}

function formatTime(value?: string) {
  return formatShanghaiTime(value)
}

function normalizeThresholds(value?: Array<number | string>) {
  const thresholds = (value?.length ? value : defaultThresholds)
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 1 && item <= 365)
  return [...new Set(thresholds)].sort((a, b) => b - a)
}

function validateThresholds(_: unknown, value?: Array<number | string>) {
  if (!value?.length) return Promise.reject(new Error('请至少填写一个告警阈值'))
  return normalizeThresholds(value).length === value.length ? Promise.resolve() : Promise.reject(new Error('阈值必须是 1-365 的整数天数'))
}

function RemainingDays({ value }: { value: number | null }) {
  if (value === null) return <Tag color="default">-</Tag>
  if (value <= 0) return <Tag color="red">{value} 天</Tag>
  if (value <= 7) return <Tag color="red">{value} 天</Tag>
  if (value <= 30) return <Tag color="orange">{value} 天</Tag>
  return <Tag color="green">{value} 天</Tag>
}

function toPayload(values: FormValues): SslCertificateMonitorInput {
  return {
    name: values.name,
    description: values.description,
    enabled: values.enabled,
    domain: values.domain,
    serverIp: values.serverIp,
    port: values.port,
    thresholds: normalizeThresholds(values.thresholds),
    checkTime: values.checkTime || '08:30',
    alertLevel: values.alertLevel || '警告',
    notification: {
      receivers: values.receivers,
    },
  }
}

function toFormValues(record?: SslCertificateMonitor): Partial<FormValues> {
  return record
    ? {
      name: record.name,
      description: record.description,
      enabled: record.enabled,
      domain: record.domain,
      serverIp: record.serverIp,
      port: record.port,
      thresholds: record.thresholds,
      checkTime: record.checkTime,
      alertLevel: record.alertLevel,
      receivers: record.notification.receivers,
    }
    : { enabled: true, port: 443, thresholds: defaultThresholds, checkTime: '08:30', alertLevel: '警告' }
}

export default function SslCertificateMonitorPage() {
  const [items, setItems] = useState<SslCertificateMonitor[]>([])
  const [histories, setHistories] = useState<SslCertificateHistory[]>([])
  const [status, setStatus] = useState<SslCertificateStatus>()
  const [keyword, setKeyword] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [checkingId, setCheckingId] = useState<string>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<SslCertificateMonitor>()
  const [historyTarget, setHistoryTarget] = useState<SslCertificateMonitor>()
  const [form] = Form.useForm<FormValues>()

  const load = async () => {
    setLoading(true)
    try {
      setItems(await listSslCertificateMonitors())
    } catch (error) {
      message.error(getErrorMessage(error, '加载 SSL 证书监控失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const stats = useMemo(() => ({
    total: items.length,
    normal: items.filter((item) => item.status === 'normal').length,
    expiring: items.filter((item) => item.status === 'expiring').length,
    risky: items.filter((item) => item.status === 'expired' || item.status === 'failed').length,
  }), [items])

  const filtered = useMemo(() => items.filter((item) => {
    const matchedStatus = !status || item.status === status
    const text = `${item.name} ${item.domain} ${item.serverIp ?? ''}`.toLowerCase()
    const matchedKeyword = !keyword || text.includes(keyword.toLowerCase())
    return matchedStatus && matchedKeyword
  }), [items, keyword, status])

  const openCreate = () => {
    setEditing(undefined)
    form.setFieldsValue(toFormValues())
    setDrawerOpen(true)
  }

  const openEdit = (record: SslCertificateMonitor) => {
    setEditing(record)
    form.setFieldsValue(toFormValues(record))
    setDrawerOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    setSaving(true)
    try {
      if (editing) await updateSslCertificateMonitor(editing.id, toPayload(values))
      else await createSslCertificateMonitor(toPayload(values))
      message.success(editing ? 'SSL 证书监控已更新' : 'SSL 证书监控已创建并完成首次检测')
      setDrawerOpen(false)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '保存 SSL 证书监控失败'))
    } finally {
      setSaving(false)
    }
  }

  const runCheck = async (record: SslCertificateMonitor) => {
    setCheckingId(record.id)
    try {
      await checkSslCertificateMonitor(record.id)
      message.success('检测完成')
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '检测失败'))
    } finally {
      setCheckingId(undefined)
    }
  }

  const remove = async (record: SslCertificateMonitor) => {
    await deleteSslCertificateMonitor(record.id)
    message.success('SSL 证书监控已删除')
    await load()
  }

  const openHistory = async (record: SslCertificateMonitor) => {
    setHistoryTarget(record)
    try {
      setHistories(await listSslCertificateHistories(record.id))
    } catch (error) {
      message.error(getErrorMessage(error, '加载检测历史失败'))
    }
  }

  const columns: ColumnsType<SslCertificateMonitor> = [
    { title: '规则/域名', fixed: 'left', width: 240, render: (_, record) => <Space direction="vertical" size={0}><Typography.Text strong>{record.name}</Typography.Text><Typography.Text code copyable={{ text: record.domain }}>{record.domain}</Typography.Text></Space> },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: SslCertificateStatus) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
    { title: '启用', dataIndex: 'enabled', width: 80, render: (value) => <Tag color={value ? 'green' : 'default'}>{value ? '启用' : '停用'}</Tag> },
    { title: '服务器 IP', dataIndex: 'serverIp', width: 140, render: (value) => value || '-' },
    { title: '端口', dataIndex: 'port', width: 80 },
    { title: '颁发者', dataIndex: 'issuer', width: 220, ellipsis: true, render: (value) => value || '-' },
    { title: '有效期结束', dataIndex: 'validTo', width: 170, render: formatTime },
    { title: '剩余天数', dataIndex: 'remainingDays', width: 110, render: (value) => <RemainingDays value={value} /> },
    { title: '域名匹配', dataIndex: 'domainMatched', width: 110, render: (value, record) => record.status === 'unknown' ? '-' : <Tag color={value ? 'green' : 'red'}>{value ? '匹配' : '不匹配'}</Tag> },
    { title: '阈值', dataIndex: 'thresholds', width: 120, render: (value: number[]) => value.join('/') },
    { title: '最近检测', dataIndex: 'lastCheckedAt', width: 170, render: formatTime },
    { title: '下次检测', dataIndex: 'nextCheckAt', width: 170, render: formatTime },
    { title: '错误信息', dataIndex: 'lastError', width: 220, ellipsis: true, render: (value) => value || '-' },
    { title: '操作', fixed: 'right', width: 260, render: (_, record) => <Space><PermissionGate permission={PERMISSIONS.SSL_CERTIFICATES_MANAGE}><Button size="small" loading={checkingId === record.id} onClick={() => void runCheck(record)}>检测</Button></PermissionGate><PermissionGate permission={PERMISSIONS.SSL_CERTIFICATES_MANAGE}><Button size="small" onClick={() => openEdit(record)}>编辑</Button></PermissionGate><Button size="small" onClick={() => void openHistory(record)}>历史</Button><PermissionGate permission={PERMISSIONS.SSL_CERTIFICATES_MANAGE}><Popconfirm title="确认删除这个证书监控吗？" onConfirm={() => void remove(record)}><Button size="small" danger>删除</Button></Popconfirm></PermissionGate></Space> },
  ]

  const historyColumns: ColumnsType<SslCertificateHistory> = [
    { title: '检测时间', dataIndex: 'checkedAt', width: 170, render: formatTime },
    { title: '状态', dataIndex: 'status', width: 110, render: (value: SslCertificateStatus) => <Tag color={statusColors[value]}>{statusLabels[value]}</Tag> },
    { title: '有效期结束', dataIndex: 'validTo', width: 170, render: formatTime },
    { title: '剩余天数', dataIndex: 'remainingDays', width: 110, render: (value) => <RemainingDays value={value} /> },
    { title: '命中阈值', dataIndex: 'matchedThreshold', width: 110, render: (value) => value ? `${value} 天` : '-' },
    { title: '域名匹配', dataIndex: 'domainMatched', width: 100, render: (value) => value ? '匹配' : '不匹配' },
    { title: '告警ID', dataIndex: 'alertId', width: 180, ellipsis: true, render: (value) => value || '-' },
    { title: '通知结果', dataIndex: 'notificationResults', width: 260, render: (value: string[]) => value?.length ? value.join('；') : '-' },
    { title: '错误信息', dataIndex: 'errorMessage', width: 260, render: (value) => value || '-' },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div>
            <Typography.Title level={3}>SSL 证书监控</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>监控域名证书有效期、域名匹配和到期告警。</Typography.Paragraph>
          </div>
          <PermissionGate permission={PERMISSIONS.SSL_CERTIFICATES_MANAGE}>
            <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加域名</Button>
          </PermissionGate>
        </div>
      </Card>

      <Alert type="info" showIcon message="检测说明" description="平台服务端会真实发起 TLS 握手读取证书有效期。命中阈值、证书过期、获取失败或域名不匹配时会进入告警中心，并按设置模块的全局通知配置发送。" />

      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card><Statistic title="监控总数" value={stats.total} prefix={<ApiOutlined />} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="正常" value={stats.normal} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="即将过期" value={stats.expiring} prefix={<ClockCircleOutlined />} valueStyle={{ color: '#faad14' }} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="已过期/失败" value={stats.risky} prefix={<ExclamationCircleOutlined />} valueStyle={{ color: '#ff4d4f' }} /></Card></Col>
      </Row>

      <Card>
        <Space wrap style={{ marginBottom: 16 }}>
          <Input.Search placeholder="搜索域名、规则名、服务器 IP" allowClear onSearch={setKeyword} onChange={(event) => setKeyword(event.target.value)} style={{ width: 300 }} />
          <Select placeholder="状态" allowClear value={status} onChange={setStatus} style={{ width: 180 }} options={Object.entries(statusLabels).map(([value, label]) => ({ value, label }))} />
        </Space>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={filtered} scroll={{ x: 1900 }} pagination={{ pageSize: 10 }} />
      </Card>

      <Drawer title={editing ? `编辑 ${editing.domain}` : '添加 SSL 证书监控'} open={drawerOpen} onClose={() => setDrawerOpen(false)} width={620} extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" loading={saving} onClick={() => void submit()}>保存</Button></Space>} destroyOnClose>
        <Form form={form} layout="vertical">
          <Form.Item name="enabled" label="启用状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item>
          <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input placeholder="例如：交易网关证书" /></Form.Item>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} /></Form.Item>
          <Row gutter={12}>
            <Col span={16}><Form.Item name="domain" label="域名" rules={[{ required: true, message: '请输入域名' }]}><Input placeholder="example.com（不含 https:// 和路径）" /></Form.Item></Col>
            <Col span={8}><Form.Item name="port" label="端口"><InputNumber min={1} max={65535} style={{ width: '100%' }} /></Form.Item></Col>
          </Row>
          <Form.Item name="serverIp" label="服务器 IP"><Input placeholder="可选，用于告警内容展示" /></Form.Item>
          <Form.Item name="thresholds" label="告警阈值" rules={[{ validator: validateThresholds }]}><Select mode="tags" tokenSeparators={[',', '，', ' ']} options={thresholdOptions} placeholder="例如 30、15、7" /></Form.Item>
          <Row gutter={12}>
            <Col span={12}><Form.Item name="checkTime" label="每日检测时间"><Input placeholder="08:30" /></Form.Item></Col>
            <Col span={12}><Form.Item name="alertLevel" label="告警级别"><Select options={alertLevelOptions.map((value) => ({ label: value, value }))} /></Form.Item></Col>
          </Row>
          <Form.Item name="receivers" label="告警负责人"><Input placeholder="可选，用于告警归属" /></Form.Item>
        </Form>
      </Drawer>

      <Modal title={`检测历史 ${historyTarget?.domain ?? ''}`} open={Boolean(historyTarget)} onCancel={() => setHistoryTarget(undefined)} width={1100} footer={null} destroyOnClose>
        {historyTarget ? <Descriptions size="small" column={3} style={{ marginBottom: 16 }}>
          <Descriptions.Item label="域名">{historyTarget.domain}:{historyTarget.port}</Descriptions.Item>
          <Descriptions.Item label="当前状态"><Tag color={statusColors[historyTarget.status]}>{statusLabels[historyTarget.status]}</Tag></Descriptions.Item>
          <Descriptions.Item label="剩余天数"><RemainingDays value={historyTarget.remainingDays} /></Descriptions.Item>
        </Descriptions> : null}
        <Table rowKey="id" size="small" columns={historyColumns} dataSource={histories} pagination={{ pageSize: 8 }} scroll={{ x: 1520 }} />
      </Modal>
    </Space>
  )
}
