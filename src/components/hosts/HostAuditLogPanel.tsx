import { Card, Form, Input, Select, Table, Tag } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { HostAuditLog } from '../../types/host'

interface Props {
  logs: HostAuditLog[]
}

export default function HostAuditLogPanel({ logs }: Props) {
  const [form] = Form.useForm()
  const values = Form.useWatch([], form)
  const filteredLogs = logs.filter((log) => {
    const matchOperator = !values?.operator || log.operator.includes(values.operator)
    const matchAction = !values?.action || log.action === values.action
    const matchResult = !values?.result || log.result === values.result
    return matchOperator && matchAction && matchResult
  })

  const columns: ColumnsType<HostAuditLog> = [
    { title: '时间', dataIndex: 'time', width: 170 },
    { title: '操作人', dataIndex: 'operator', width: 130 },
    { title: '操作', dataIndex: 'action', width: 130, render: (value) => <Tag color="blue">{value}</Tag> },
    { title: '目标', dataIndex: 'target', width: 150 },
    { title: '结果', dataIndex: 'result', width: 90, render: (value) => <Tag color={value === '成功' ? 'green' : 'red'}>{value}</Tag> },
    { title: '详情', dataIndex: 'detail', ellipsis: true },
    { title: '哈希链', dataIndex: 'hash', width: 210, render: (_, record) => <div className="audit-hash"><div>prev: {record.previousHash}</div><div>hash: {record.hash}</div></div> },
    { title: '保留至', dataIndex: 'retentionUntil', width: 120 },
  ]

  return (
    <Card title="主机操作审计日志">
      <div className="mb-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-blue-100">
        SSH/WinRM Pull 凭据仅加密保存密文，不进入审计日志或导出内容；审计日志按 7 年留存策略记录。
      </div>
      <Form form={form} layout="inline" className="mb-5">
        <Form.Item name="operator"><Input allowClear placeholder="操作人" /></Form.Item>
        <Form.Item name="action"><Select allowClear placeholder="操作类型" style={{ width: 160 }} options={['新增主机', '测试连接', '编辑主机', '删除主机', '重新纳管', '刷新主机信息', '拉取主机指标', '启用自动Pull', '停用自动Pull', '重新安装Agent', '重启Agent', '诊断Agent回连', '修复Agent回连路由', '查看详情'].map((value) => ({ label: value, value }))} /></Form.Item>
        <Form.Item name="result"><Select allowClear placeholder="结果" style={{ width: 120 }} options={['成功', '失败'].map((value) => ({ label: value, value }))} /></Form.Item>
      </Form>
      <Table rowKey="id" columns={columns} dataSource={filteredLogs} pagination={{ pageSize: 6 }} />
    </Card>
  )
}
