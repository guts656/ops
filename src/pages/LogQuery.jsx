import { SearchOutlined } from '@ant-design/icons'
import { Button, Card, DatePicker, Flex, Form, Input, Select, Table, Tag, Typography } from 'antd'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { queryHosts } from '../api/hosts'
import { getLogServices, queryLogs } from '../api/logs'

const { RangePicker } = DatePicker
const levelColor = { ERROR: 'red', WARN: 'gold', INFO: 'blue', DEBUG: 'default' }

function toQueryValues(values, page, pageSize) {
  return {
    keyword: values.keyword || undefined,
    service: values.service || undefined,
    level: values.level || undefined,
    hostId: values.hostId || undefined,
    source: values.source || undefined,
    startTime: values.range?.[0]?.toDate().toISOString(),
    endTime: values.range?.[1]?.toDate().toISOString(),
    page,
    pageSize,
  }
}

export default function LogQuery() {
  const [form] = Form.useForm()
  const [searchParams] = useSearchParams()
  const initialService = searchParams.get('service') || undefined
  const initialHostId = searchParams.get('hostId') || undefined
  const [logs, setLogs] = useState([])
  const [services, setServices] = useState([])
  const [hosts, setHosts] = useState([])
  const [loading, setLoading] = useState(false)
  const [pagination, setPagination] = useState({ current: 1, pageSize: 8, total: 0 })

  const serviceOptions = useMemo(
    () => services.map((service) => ({ label: service.startsWith('container:') ? `容器：${service.replace('container:', '')}` : service, value: service })),
    [services],
  )
  const hostOptions = useMemo(
    () => hosts.map((host) => ({ label: `${host.ip} / ${host.hostname}`, value: host.id })),
    [hosts],
  )
  const sourceOptions = [
    { label: 'Windows Application', value: 'eventlog:Application' },
    { label: 'Windows System', value: 'eventlog:System' },
    { label: 'Docker 容器', value: 'docker' },
    { label: '指定文件路径', value: 'file' },
  ]

  const load = useCallback(async (page = 1, pageSize = 8) => {
    setLoading(true)
    try {
      const values = form.getFieldsValue()
      const result = await queryLogs(toQueryValues(values, page, pageSize))
      setLogs(result.data)
      setPagination({ current: result.page, pageSize: result.pageSize, total: result.total })
    } finally {
      setLoading(false)
    }
  }, [form])

  useEffect(() => {
    async function init() {
      form.setFieldsValue({ service: initialService, hostId: initialHostId })
      const [nextServices, nextHosts] = await Promise.all([getLogServices(), queryHosts({}), load(1, 8)])
      setServices(nextServices)
      setHosts(nextHosts)
    }
    void init()
  }, [form, initialHostId, initialService, load])

  return (
    <Flex vertical gap="large" style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={3}>日志查询</Typography.Title>
        <Typography.Paragraph type="secondary">
          查询后端持久化日志，支持关键字、主机、来源、服务、级别和时间范围筛选，分页由服务端完成以避免大日志量下前端卡顿。
        </Typography.Paragraph>
      </Card>

      <Card title="查询条件">
        <Form form={form} layout="vertical" onFinish={() => load(1, pagination.pageSize)}>
          <div className="log-filter-grid">
            <Form.Item name="keyword" label="关键字">
              <Input allowClear placeholder="输入 Trace ID、错误码或消息关键字" prefix={<SearchOutlined />} />
            </Form.Item>
            <Form.Item name="hostId" label="主机">
              <Select allowClear placeholder="选择主机" options={hostOptions} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="source" label="来源">
              <Select allowClear placeholder="选择来源" options={sourceOptions} />
            </Form.Item>
            <Form.Item name="service" label="服务/容器">
              <Select allowClear placeholder="选择服务或容器" options={serviceOptions} showSearch optionFilterProp="label" />
            </Form.Item>
            <Form.Item name="level" label="日志级别">
              <Select
                allowClear
                placeholder="选择级别"
                options={['ERROR', 'WARN', 'INFO'].map((level) => ({ label: level, value: level }))}
              />
            </Form.Item>
            <Form.Item name="range" label="时间范围">
              <RangePicker showTime style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Flex gap="small" wrap>
            <Button type="primary" htmlType="submit" loading={loading}>
              查询日志
            </Button>
            <Button
              onClick={() => {
                form.resetFields()
                void load(1, pagination.pageSize)
              }}
            >
              重置
            </Button>
          </Flex>
        </Form>
      </Card>

      <Card title={`日志结果（${pagination.total}）`}>
        <Table
          rowKey="id"
          loading={loading}
          dataSource={logs}
          pagination={{
            current: pagination.current,
            pageSize: pagination.pageSize,
            total: pagination.total,
            showSizeChanger: true,
            pageSizeOptions: [8, 20, 50, 100],
            showTotal: (total) => `共 ${total} 条`,
          }}
          onChange={(next) => load(next.current, next.pageSize)}
          columns={[
            { title: '时间', dataIndex: 'time', width: 180 },
            { title: '主机', dataIndex: 'hostId', width: 190, render: (hostId) => hosts.find((host) => host.id === hostId)?.hostname || hostId || '-' },
            { title: '来源', dataIndex: 'source', width: 160, render: (source) => source === 'docker' ? 'Docker 容器' : source?.startsWith('eventlog:') ? `Windows ${source.replace('eventlog:', '')}` : source || '-' },
            { title: '服务/容器', dataIndex: 'service', width: 180 },
            {
              title: '级别',
              dataIndex: 'level',
              width: 100,
              render: (level) => <Tag color={levelColor[level]}>{level}</Tag>,
            },
            { title: 'Trace ID', dataIndex: 'traceId', width: 160, render: (traceId) => <Typography.Text code>{traceId}</Typography.Text> },
            { title: '消息', dataIndex: 'message', render: (message) => <span className="log-message">{message}</span> },
          ]}
        />
      </Card>
    </Flex>
  )
}
