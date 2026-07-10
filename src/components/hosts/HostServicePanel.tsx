import { Button, Card, Empty, Popconfirm, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import PermissionGate from '../auth/PermissionGate'
import { PERMISSIONS } from '../../config/permissions'
import type { HostServiceItem } from '../../types/service'

const statusColor: Record<string, string> = {
  running: 'green',
  active: 'green',
  Running: 'green',
  failed: 'red',
  error: 'red',
  dead: 'red',
  missing: 'red',
  removed: 'red',
  stopped: 'gold',
  inactive: 'gold',
  exited: 'gold',
  not_running: 'gold',
  unknown: 'default',
}
const healthyStatuses = new Set(['running', 'active'])

interface Props {
  services?: HostServiceItem[]
  onStart?: (service: HostServiceItem) => void
  onStop?: (service: HostServiceItem) => void
  onDelete?: (service: HostServiceItem) => void
}

function isHealthy(status: string) {
  return healthyStatuses.has(String(status).toLowerCase())
}

export default function HostServicePanel({ services = [], onStart, onStop, onDelete }: Props) {
  const columns: ColumnsType<HostServiceItem> = [
    { title: '服务', dataIndex: 'name', render: (value) => <Typography.Text strong>{value}</Typography.Text> },
    { title: '状态', dataIndex: 'status', width: 120, render: (value) => <Tag color={statusColor[String(value)] || statusColor[String(value).toLowerCase()] || 'blue'}>{value}</Tag> },
    { title: '端口', dataIndex: 'port', width: 90, render: (value) => value || '-' },
    { title: '协议', dataIndex: 'protocol', width: 100, render: (value) => value || '-' },
    { title: '版本/PID', width: 140, render: (_, record) => record.version || record.pid || '-' },
    { title: '来源', dataIndex: 'source', width: 110 },
    { title: '最近上报', dataIndex: 'lastReportedAt', width: 210 },
    {
      title: '操作',
      width: 220,
      render: (_, record) => (
        <PermissionGate permission={PERMISSIONS.HOSTS_AGENT}>
          <Space wrap>
            {isHealthy(record.status) ? <Button type="link" onClick={() => onStop?.(record)}>停止</Button> : <Button type="link" onClick={() => onStart?.(record)}>启动</Button>}
            <Popconfirm
              title="删除服务记录？"
              description="仅删除平台中的服务记录，不会卸载或删除主机上的真实服务；如果 Agent 后续仍上报该服务，记录会重新出现。"
              onConfirm={() => onDelete?.(record)}
            >
              <Button type="link" danger>删除记录</Button>
            </Popconfirm>
          </Space>
        </PermissionGate>
      ),
    },
  ]

  return (
    <Card title="Agent 上报服务">
      {services.length ? <Table rowKey="id" columns={columns} dataSource={services} pagination={{ pageSize: 6 }} /> : <Empty description="暂无 Agent 上报服务" />}
    </Card>
  )
}
