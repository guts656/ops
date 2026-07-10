import { Card, Empty, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AppLog } from '../../types/log'

const levelColor: Record<string, string> = { ERROR: 'red', WARN: 'gold', INFO: 'blue', DEBUG: 'default' }

function sourceLabel(value?: string) {
  if (!value) return '-'
  if (value === 'docker') return 'Docker 容器'
  if (value.startsWith('eventlog:')) return `Windows ${value.replace('eventlog:', '')}`
  return value
}

export default function HostLogPanel({ logs = [] }: { logs: AppLog[] }) {
  const columns: ColumnsType<AppLog> = [
    { title: '时间', dataIndex: 'time', width: 180 },
    { title: '来源', dataIndex: 'source', width: 150, render: sourceLabel },
    { title: '服务/容器', dataIndex: 'service', width: 220, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '级别', dataIndex: 'level', width: 90, render: (value) => <Tag color={levelColor[value] || 'default'}>{value}</Tag> },
    { title: 'Trace ID', dataIndex: 'traceId', width: 190, render: (value) => <Typography.Text code copyable>{value}</Typography.Text> },
    { title: '消息', dataIndex: 'message', render: (value) => <span className="log-message">{value}</span> },
  ]

  return (
    <Card title="异常日志">
      {logs.length ? <Table rowKey="id" columns={columns} dataSource={logs} pagination={{ pageSize: 8 }} /> : <Empty description="暂无异常日志" />}
    </Card>
  )
}
