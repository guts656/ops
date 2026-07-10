import { Card, Empty, Progress, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { HostContainerItem } from '../../types/container'

const stateColor: Record<string, string> = { running: 'green', restarting: 'gold', paused: 'gold', exited: 'red', dead: 'red', created: 'blue' }

function formatBytes(value?: string) {
  const bytes = Number(value || 0)
  if (!bytes) return '-'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let size = bytes
  let unitIndex = 0
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }
  return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`
}

function formatPorts(value: unknown) {
  if (!value) return '-'
  if (typeof value === 'string') return value || '-'
  return JSON.stringify(value)
}

export default function HostContainerPanel({ containers = [] }: { containers: HostContainerItem[] }) {
  const columns: ColumnsType<HostContainerItem> = [
    { title: '容器', dataIndex: 'name', width: 180, render: (value, record) => <div><Typography.Text strong>{value}</Typography.Text><br /><Typography.Text type="secondary" copyable>{record.containerId.slice(0, 12)}</Typography.Text></div> },
    { title: '镜像', dataIndex: 'image', ellipsis: true, render: (value) => <Typography.Text>{value}</Typography.Text> },
    { title: '状态', dataIndex: 'state', width: 110, render: (value, record) => <Tag color={stateColor[String(value).toLowerCase()] || 'default'}>{record.status || value}</Tag> },
    { title: 'CPU', dataIndex: 'cpuPercent', width: 90, render: (value) => value === undefined ? '-' : <Progress type="circle" size={42} percent={value} /> },
    { title: '内存', width: 130, render: (_, record) => record.memoryPercent === undefined ? formatBytes(record.memoryUsageBytes) : <Progress percent={record.memoryPercent} size="small" /> },
    { title: '端口映射', dataIndex: 'ports', width: 180, ellipsis: true, render: formatPorts },
    { title: '重启', dataIndex: 'restartCount', width: 80 },
    { title: '最近上报', dataIndex: 'lastReportedAt', width: 180 },
  ]

  return (
    <Card title="Docker 容器" extra={<Typography.Text type="secondary">默认展示当前监控容器</Typography.Text>}>
      {containers.length ? <Table rowKey="id" columns={columns} dataSource={containers} pagination={{ pageSize: 6 }} /> : <Empty description="暂无 Docker 容器上报" />}
    </Card>
  )
}
