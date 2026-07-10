import { CheckCircleOutlined, ClockCircleOutlined, CloudDownloadOutlined, FileProtectOutlined, SearchOutlined, StopOutlined, WarningOutlined } from '@ant-design/icons'
import { Alert, Button, Card, DatePicker, Descriptions, Form, Input, Modal, Radio, Select, Space, Statistic, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType, TablePaginationConfig } from 'antd/es/table'
import dayjs, { type Dayjs } from 'dayjs'
import { useEffect, useMemo, useState } from 'react'
import { downloadAuditExport, exportAuditLogs, getAuditLogDetail, getAuditLogOptions, queryAuditLogs } from '../api/auditLogs'
import type { AuditExportFormat, AuditExportTask, AuditLogDetail, AuditLogFilters, AuditLogItem, AuditLogOptions } from '../types/auditLog'

const { RangePicker } = DatePicker

type AuditFilterValues = Omit<AuditLogFilters, 'startTime' | 'endTime'> & { timeRange?: [Dayjs, Dayjs] }

const hashStatus = {
  valid: { color: 'green', text: '通过', icon: <CheckCircleOutlined /> },
  invalid: { color: 'red', text: '失败', icon: <WarningOutlined /> },
  not_applicable: { color: 'default', text: '未启用', icon: <StopOutlined /> },
}

const quickRanges: Record<string, [Dayjs, Dayjs]> = {
  今天: [dayjs().startOf('day'), dayjs().endOf('day')],
  最近7天: [dayjs().subtract(6, 'day').startOf('day'), dayjs().endOf('day')],
  最近30天: [dayjs().subtract(29, 'day').startOf('day'), dayjs().endOf('day')],
}

function normalizeFilters(values: AuditFilterValues): AuditLogFilters {
  const [start, end] = values.timeRange ?? []
  return {
    startTime: start?.toISOString(),
    endTime: end?.toISOString(),
    operator: values.operator?.trim() || undefined,
    actionType: values.actionType,
    resourceType: values.resourceType,
    clientIp: values.clientIp?.trim() || undefined,
  }
}

function JsonBlock({ value }: { value: unknown }) {
  return <pre className="audit-json-block">{JSON.stringify(value, null, 2)}</pre>
}

export default function AuditLogs() {
  const [form] = Form.useForm<AuditFilterValues>()
  const [logs, setLogs] = useState<AuditLogItem[]>([])
  const [options, setOptions] = useState<AuditLogOptions>({ actionTypes: [], resourceTypes: [] })
  const [filters, setFilters] = useState<AuditLogFilters>({})
  const [pagination, setPagination] = useState({ page: 1, pageSize: 10, total: 0 })
  const [loading, setLoading] = useState(false)
  const [detail, setDetail] = useState<AuditLogDetail>()
  const [detailLoading, setDetailLoading] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [exportFormat, setExportFormat] = useState<AuditExportFormat>('csv')
  const [exporting, setExporting] = useState(false)
  const [exportTasks, setExportTasks] = useState<AuditExportTask[]>([])

  const loadLogs = async (nextPage = pagination.page, nextPageSize = pagination.pageSize, nextFilters = filters) => {
    setLoading(true)
    try {
      const result = await queryAuditLogs({ ...nextFilters, page: nextPage, pageSize: nextPageSize })
      setLogs(result.data)
      setFilters(nextFilters)
      setPagination({ page: result.page, pageSize: result.pageSize, total: result.total })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void Promise.all([loadLogs(1, 10, {}), getAuditLogOptions().then(setOptions)])
  }, [])

  const stats = useMemo(() => {
    const invalid = logs.filter((log) => log.hashChainStatus === 'invalid').length
    const verified = logs.filter((log) => log.hashChainStatus === 'valid').length
    return { total: pagination.total, verified, invalid, operators: new Set(logs.map((log) => log.operator)).size }
  }, [logs, pagination.total])

  const handleSearch = async () => {
    const values = await form.validateFields()
    const nextFilters = normalizeFilters(values)
    await loadLogs(1, pagination.pageSize, nextFilters)
  }

  const handleReset = async () => {
    form.resetFields()
    await loadLogs(1, pagination.pageSize, {})
  }

  const openDetail = async (record: AuditLogItem) => {
    setDetailLoading(true)
    try {
      setDetail(await getAuditLogDetail(record.id))
    } finally {
      setDetailLoading(false)
    }
  }

  const handleTableChange = async (config: TablePaginationConfig) => {
    await loadLogs(config.current ?? 1, config.pageSize ?? pagination.pageSize)
  }

  const handleExport = async () => {
    setExporting(true)
    try {
      const task = await exportAuditLogs(exportFormat, filters)
      setExportTasks((current) => [task, ...current])
      message.success('导出任务已完成，可在导出记录中下载')
      setExportOpen(false)
    } finally {
      setExporting(false)
    }
  }

  const columns: ColumnsType<AuditLogItem> = [
    { title: '时间', dataIndex: 'time', sorter: (left, right) => left.timestamp - right.timestamp, defaultSortOrder: 'descend', width: 180 },
    { title: '操作人', dataIndex: 'operator', width: 140, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '操作类型', dataIndex: 'actionType', width: 150, render: (value) => <Tag color="blue">{value}</Tag> },
    { title: '资源类型', dataIndex: 'resourceType', width: 120 },
    { title: '资源ID', dataIndex: 'resourceId', width: 170, ellipsis: true },
    { title: '操作内容', dataIndex: 'content', width: 260, ellipsis: true, render: (value) => <Typography.Text>{value}</Typography.Text> },
    { title: '客户端IP', dataIndex: 'clientIp', width: 130 },
    { title: 'hash链状态', dataIndex: 'hashChainStatus', width: 130, render: (value) => <Tag icon={hashStatus[value].icon} color={hashStatus[value].color}>{hashStatus[value].text}</Tag> },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card className="audit-center-hero">
        <div className="audit-hero-grid" />
        <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Typography.Text className="audit-eyebrow">AUDIT COMMAND CENTER</Typography.Text>
            <Typography.Title level={2} style={{ margin: '8px 0 10px' }}>审计日志中心</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ maxWidth: 720, marginBottom: 0 }}>
              汇聚账号、自愈和主机操作记录，以时间线、筛选器和 hash 链校验帮助审计员快速完成追溯分析。
            </Typography.Paragraph>
          </div>
          <Button type="primary" size="large" icon={<CloudDownloadOutlined />} onClick={() => setExportOpen(true)}>导出日志</Button>
        </Space>
      </Card>

      <Space size="large" wrap>
        <Card className="metric-card"><Statistic title="匹配日志" value={stats.total} prefix={<FileProtectOutlined />} /></Card>
        <Card className="metric-card"><Statistic title="hash通过" value={stats.verified} valueStyle={{ color: '#52c41a' }} prefix={<CheckCircleOutlined />} /></Card>
        <Card className="metric-card"><Statistic title="hash异常" value={stats.invalid} valueStyle={{ color: stats.invalid ? '#ff4d4f' : '#52c41a' }} prefix={<WarningOutlined />} /></Card>
        <Card className="metric-card"><Statistic title="当前页操作人" value={stats.operators} prefix={<ClockCircleOutlined />} /></Card>
      </Space>

      <Card title="筛选条件">
        <Form form={form} layout="vertical" onFinish={handleSearch}>
          <div className="audit-filter-grid">
            <Form.Item name="timeRange" label="时间范围"><RangePicker showTime ranges={quickRanges} style={{ width: '100%' }} /></Form.Item>
            <Form.Item name="operator" label="操作人"><Input allowClear placeholder="支持模糊搜索" /></Form.Item>
            <Form.Item name="actionType" label="操作类型"><Select allowClear placeholder="全部类型" options={options.actionTypes.map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item name="resourceType" label="资源类型"><Select allowClear placeholder="全部资源" options={options.resourceTypes.map((value) => ({ label: value, value }))} /></Form.Item>
            <Form.Item name="clientIp" label="客户端 IP"><Input allowClear placeholder="例如 10.16.1.21" /></Form.Item>
            <Form.Item label=" ">
              <Space wrap>
                <Button type="primary" htmlType="submit" icon={<SearchOutlined />}>查询</Button>
                <Button onClick={handleReset}>重置</Button>
                <Button icon={<CloudDownloadOutlined />} onClick={() => setExportOpen(true)}>导出</Button>
              </Space>
            </Form.Item>
          </div>
        </Form>
      </Card>

      <Card title="日志列表">
        <Table
          rowKey="id"
          loading={loading}
          columns={columns}
          dataSource={logs}
          onChange={handleTableChange}
          onRow={(record) => ({ onClick: () => void openDetail(record) })}
          rowClassName="audit-log-row"
          pagination={{ current: pagination.page, pageSize: pagination.pageSize, total: pagination.total, showSizeChanger: true }}
          scroll={{ x: 1180 }}
        />
      </Card>

      {exportTasks.length > 0 && (
        <Card title="导出记录">
          <Space direction="vertical" style={{ width: '100%' }}>
            {exportTasks.map((task) => (
              <Alert
                key={task.id}
                type="success"
                showIcon
                message={task.fileName}
                description={<Space><span>任务已完成</span><Button type="link" size="small" onClick={() => void downloadAuditExport(task)}>下载文件</Button></Space>}
              />
            ))}
          </Space>
        </Card>
      )}

      <Modal title="导出审计日志" open={exportOpen} onCancel={() => setExportOpen(false)} onOk={handleExport} confirmLoading={exporting} okText="提交导出任务" cancelText="取消">
        <Space direction="vertical" size="middle">
          <Typography.Paragraph type="secondary">将基于当前筛选条件生成异步导出任务，任务完成后会出现在导出记录中。</Typography.Paragraph>
          <Radio.Group value={exportFormat} onChange={(event) => setExportFormat(event.target.value)}>
            <Radio.Button value="csv">CSV</Radio.Button>
            <Radio.Button value="json">JSON</Radio.Button>
          </Radio.Group>
        </Space>
      </Modal>

      <Modal title="审计日志详情" open={Boolean(detail) || detailLoading} onCancel={() => setDetail(undefined)} footer={null} width={920} loading={detailLoading} destroyOnHidden>
        {detail && (
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <Alert
              type={detail.hashVerification.status === 'invalid' ? 'error' : detail.hashVerification.status === 'valid' ? 'success' : 'info'}
              showIcon
              message={detail.hashVerification.message}
            />
            <Descriptions bordered column={2} size="small">
              <Descriptions.Item label="日志ID">{detail.id}</Descriptions.Item>
              <Descriptions.Item label="时间">{detail.time}</Descriptions.Item>
              <Descriptions.Item label="操作人">{detail.operator}</Descriptions.Item>
              <Descriptions.Item label="客户端IP">{detail.clientIp}</Descriptions.Item>
              <Descriptions.Item label="操作类型">{detail.actionType}</Descriptions.Item>
              <Descriptions.Item label="资源类型">{detail.resourceType}</Descriptions.Item>
              <Descriptions.Item label="资源ID">{detail.resourceId}</Descriptions.Item>
              <Descriptions.Item label="结果">{detail.result}</Descriptions.Item>
              <Descriptions.Item label="摘要" span={2}>{detail.requestSummary}</Descriptions.Item>
            </Descriptions>
            <div>
              <Typography.Title level={5}>请求参数</Typography.Title>
              <JsonBlock value={detail.requestBody} />
            </div>
            <div>
              <Typography.Title level={5}>响应体</Typography.Title>
              <JsonBlock value={detail.responseBody} />
            </div>
          </Space>
        )}
      </Modal>
    </Space>
  )
}
