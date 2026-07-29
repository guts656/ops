import { Card, Empty, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { AgentJob } from '../../types/host'

const statusColor = { pending: 'default', running: 'blue', success: 'green', failed: 'red' }
const typeLabel = { test_connection: '测试连接', install_agent: '安装 Agent', reinstall_agent: '重新安装 Agent', restart_agent: '重启 Agent', update_agent: '更新 Agent', remanage: '重新纳管', refresh_host_info: '刷新主机信息', pull_host_metrics: '拉取主机指标', diagnose_agent_backend: '诊断 Agent 回连', repair_agent_backend_routes: '修复 Agent 回连路由', start_service: '启动服务', stop_service: '停止服务', restart_service: '重启服务', batch_run_script: '批处理脚本', batch_file_operation: '批处理文件' }
const transportLabel = { ssh: 'SSH', winrm: 'WinRM', agent: 'Agent' }

export default function AgentJobPanel({ jobs = [] }: { jobs: AgentJob[] }) {
  const columns: ColumnsType<AgentJob> = [
    { title: '任务', dataIndex: 'type', render: (value) => typeLabel[value as keyof typeof typeLabel] },
    { title: '通道', dataIndex: 'transport', render: (value) => transportLabel[value as keyof typeof transportLabel] },
    { title: '状态', dataIndex: 'status', render: (value) => <Tag color={statusColor[value as keyof typeof statusColor]}>{value}</Tag> },
    { title: '操作人', dataIndex: 'operator' },
    { title: '开始时间', dataIndex: 'startedAt', width: 210 },
    { title: '结束时间', dataIndex: 'completedAt', width: 210, render: (value) => value || '-' },
    { title: '摘要', dataIndex: 'summary', render: (value, record) => <Typography.Text type={record.status === 'failed' ? 'danger' : undefined}>{value}</Typography.Text> },
  ]

  return (
    <Card title="Agent 任务历史">
      {jobs.length ? <Table rowKey="id" columns={columns} dataSource={jobs} pagination={{ pageSize: 5 }} expandable={{ expandedRowRender: (record) => (
        <Space direction="vertical" style={{ width: '100%' }}>
          <Typography.Text strong>摘要</Typography.Text>
          <pre className="self-healing-log">{record.summary || '-'}</pre>
          <Typography.Text strong copyable={{ text: record.stdout || '' }}>stdout</Typography.Text>
          <pre className="self-healing-log">{record.stdout || '-'}</pre>
          <Typography.Text strong copyable={{ text: record.stderr || '' }}>stderr</Typography.Text>
          <pre className="self-healing-log">{record.stderr || '-'}</pre>
        </Space>
      ) }} /> : <Empty description="暂无 Agent 任务" />}
    </Card>
  )
}
