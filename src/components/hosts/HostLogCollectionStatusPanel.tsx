import { Alert, Card, Col, Descriptions, Empty, Row, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { HostLogCollectionPathStatus, HostLogCollectionStatus } from '../../types/host'
import { formatShanghaiTime } from '../../utils/time'

const statusMeta = {
  ok: { color: 'green', text: '正常', alert: 'success' as const },
  warning: { color: 'gold', text: '需关注', alert: 'warning' as const },
  error: { color: 'red', text: '异常', alert: 'error' as const },
}

function formatTime(value?: string) {
  return formatShanghaiTime(value)
}

function yesNo(value?: boolean) {
  if (value === undefined) return '-'
  return value ? <Tag color="green">存在</Tag> : <Tag color="red">不存在</Tag>
}

export default function HostLogCollectionStatusPanel({ status }: { status?: HostLogCollectionStatus }) {
  if (!status) {
    return (
      <Card title="日志采集诊断">
        <Empty description="暂无日志采集诊断数据">
          <Typography.Text type="secondary">旧版 Agent 不会上报诊断状态，重装新版离线 Agent 后会自动显示。</Typography.Text>
        </Empty>
      </Card>
    )
  }

  const meta = statusMeta[status.status] ?? statusMeta.warning
  const columns: ColumnsType<HostLogCollectionPathStatus & { key: string }> = [
    { title: '配置路径', dataIndex: 'path', width: 260, render: (value) => <Typography.Text code>{value}</Typography.Text> },
    { title: '展开后路径', dataIndex: 'expandedPath', width: 260, render: (value) => value ? <Typography.Text code>{value}</Typography.Text> : '-' },
    { title: '路径状态', dataIndex: 'exists', width: 110, render: yesNo },
    { title: '匹配文件', dataIndex: 'matchedFiles', width: 100 },
    { title: '读取行数', dataIndex: 'readLines', width: 100 },
    { title: '待上传行数', dataIndex: 'uploadedLines', width: 110 },
    { title: '错误', dataIndex: 'error', render: (value) => value ? <Typography.Text type="danger">{value}</Typography.Text> : '-' },
  ]
  const rows = status.paths.map((item, index) => ({ ...item, key: `${item.path}-${index}` }))

  return (
    <Card title="日志采集诊断" extra={<Tag color={meta.color}>{meta.text}</Tag>}>
      <Space direction="vertical" size="middle" style={{ width: '100%' }}>
        {status.lastError ? <Alert showIcon type={meta.alert} message="最近一次采集有错误" description={status.lastError} /> : null}
        <Row gutter={[12, 12]}>
          <Col xs={12} md={6}>
            <Card size="small">
              <Typography.Text type="secondary">配置路径</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0 }}>{status.configPaths.length}</Typography.Title>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Typography.Text type="secondary">匹配文件</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0 }}>{status.matchedFiles}</Typography.Title>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Typography.Text type="secondary">文件读取行数</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0 }}>{status.readLines}</Typography.Title>
            </Card>
          </Col>
          <Col xs={12} md={6}>
            <Card size="small">
              <Typography.Text type="secondary">本轮上传条数</Typography.Text>
              <Typography.Title level={4} style={{ margin: 0 }}>{status.uploadedLines}</Typography.Title>
            </Card>
          </Col>
        </Row>
        <Descriptions bordered size="small" column={2}>
          <Descriptions.Item label="采集器">{status.collector}</Descriptions.Item>
          <Descriptions.Item label="上报时间">{formatTime(status.sampledAt)}</Descriptions.Item>
          <Descriptions.Item label="Windows 事件日志">{status.eventLogs} 条</Descriptions.Item>
          <Descriptions.Item label="状态更新时间">{formatTime(status.updatedAt)}</Descriptions.Item>
        </Descriptions>
        <Table
          rowKey="key"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 6 }}
          locale={{ emptyText: '当前没有配置业务日志路径，仅采集系统事件日志' }}
        />
      </Space>
    </Card>
  )
}
