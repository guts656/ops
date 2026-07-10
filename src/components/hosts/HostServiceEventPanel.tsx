import { Card, Empty, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { ServiceEventItem } from '../../types/service'

const levelColor: Record<string, string> = { ERROR: 'red', WARN: 'gold', INFO: 'blue', DEBUG: 'default', CRITICAL: 'red' }

export default function HostServiceEventPanel({ events = [] }: { events: ServiceEventItem[] }) {
  const columns: ColumnsType<ServiceEventItem> = [
    { title: '时间', dataIndex: 'occurredAt', width: 210 },
    { title: '服务', dataIndex: 'service', width: 180, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '级别', dataIndex: 'level', width: 100, render: (value) => <Tag color={levelColor[String(value).toUpperCase()] || 'blue'}>{value}</Tag> },
    { title: '事件', dataIndex: 'eventType', width: 160 },
    { title: '消息', dataIndex: 'message', render: (value) => <span className="log-message">{value}</span> },
    { title: '来源', dataIndex: 'source', width: 110 },
  ]

  return (
    <Card title="Agent 服务事件">
      {events.length ? <Table rowKey="id" columns={columns} dataSource={events} pagination={{ pageSize: 6 }} /> : <Empty description="暂无服务事件" />}
    </Card>
  )
}
