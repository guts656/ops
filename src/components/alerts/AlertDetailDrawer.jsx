import { Descriptions, Drawer, Tag, Typography } from 'antd'

const levelColor = { 紧急: 'red', 严重: 'orange', 警告: 'gold', 提示: 'cyan' }
const statusColor = { 待处理: 'red', 处理中: 'blue', 已解决: 'green' }

function Metadata({ value }) {
  if (!value || !Object.keys(value).length) return <Typography.Text type="secondary">暂无元数据</Typography.Text>
  return <pre style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{JSON.stringify(value, null, 2)}</pre>
}

function HostTargets({ alert }) {
  const hosts = Array.isArray(alert?.hostTargets) ? alert.hostTargets : []
  if (!hosts.length) return <Typography.Text type="secondary">-</Typography.Text>
  return (
    <>
      {hosts.map((host) => (
        <span key={host.id || host.ip} style={{ display: 'inline-flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginRight: 8 }}>
          <Tag color="geekblue">IP {host.ip}</Tag>
          <Typography.Text>{host.hostname || '-'}</Typography.Text>
          {(host.tags || []).map((tag) => <Tag key={`${host.id}-${tag}`}>{tag}</Tag>)}
        </span>
      ))}
    </>
  )
}

export default function AlertDetailDrawer({ alert, open, onClose }) {
  return (
    <Drawer title="告警详情" open={open} onClose={onClose} width={620} destroyOnHidden>
      {alert && (
        <Descriptions column={1} bordered size="small">
          <Descriptions.Item label="标题">{alert.title || alert.content}</Descriptions.Item>
          <Descriptions.Item label="级别"><Tag color={levelColor[alert.level]}>{alert.level}</Tag></Descriptions.Item>
          <Descriptions.Item label="状态"><Tag color={statusColor[alert.status]}>{alert.status}</Tag></Descriptions.Item>
          <Descriptions.Item label="来源">{alert.source}</Descriptions.Item>
          <Descriptions.Item label="服务/范围">{alert.service}</Descriptions.Item>
          <Descriptions.Item label="内容">{alert.content}</Descriptions.Item>
          <Descriptions.Item label="处理人">{alert.owner}</Descriptions.Item>
          <Descriptions.Item label="发生时间">{alert.time}</Descriptions.Item>
          <Descriptions.Item label="重复次数">{alert.occurrenceCount}</Descriptions.Item>
          <Descriptions.Item label="指纹">{alert.fingerprint || '-'}</Descriptions.Item>
          <Descriptions.Item label="抑制状态">{alert.isSuppressed ? <Tag color="purple">已抑制</Tag> : <Tag color="green">正常展示</Tag>}</Descriptions.Item>
          <Descriptions.Item label="抑制原因">{alert.suppressionReason || '-'}</Descriptions.Item>
          <Descriptions.Item label="关联对象">{alert.relatedType && alert.relatedId ? `${alert.relatedType} / ${alert.relatedId}` : '-'}</Descriptions.Item>
          <Descriptions.Item label="元数据"><Metadata value={alert.metadata} /></Descriptions.Item>
        </Descriptions>
      )}
    </Drawer>
  )
}
