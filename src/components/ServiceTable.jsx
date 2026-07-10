import { Button, Table, Tag } from 'antd'

const statusRank = { 异常: 3, 警告: 2, 健康: 1 }
const statusColor = { 异常: 'error', 警告: 'warning', 健康: 'success' }

export default function ServiceTable({ data = [] }) {
  const sortedData = [...data].sort((a, b) => statusRank[b.status] - statusRank[a.status])

  return (
    <Table
      rowKey="key"
      dataSource={sortedData}
      pagination={false}
      size="middle"
      columns={[
        { title: '服务名称', dataIndex: 'name' },
        {
          title: '状态',
          dataIndex: 'status',
          render: (status) => <Tag color={statusColor[status]}>{status}</Tag>,
        },
        { title: '实例数', dataIndex: 'instances' },
        { title: '请求 QPS', dataIndex: 'qps', render: (value) => value.toLocaleString() },
        { title: '错误率', dataIndex: 'errorRate' },
        { title: '操作', render: () => <Button type="link">查看详情</Button> },
      ]}
    />
  )
}
