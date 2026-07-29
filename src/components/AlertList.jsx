import { Button, Card, Empty, Flex, Pagination, Tag, Typography } from 'antd'
import PermissionGate from './auth/PermissionGate'
import { PERMISSIONS } from '../config/permissions'

const levelColor = { 紧急: 'red', 严重: 'orange', 警告: 'gold', 提示: 'cyan' }
const statusColor = { 待处理: 'red', 处理中: 'blue', 已解决: 'green' }

function stringValue(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : ''
}

function fallbackHostTargets(item) {
  const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
  const ip = stringValue(metadata.hostIp)
  const hostname = stringValue(metadata.hostname) || stringValue(metadata.hostName) || stringValue(item.service)
  if (!ip && !hostname) return []
  return [{ id: stringValue(metadata.hostId) || ip || hostname, ip, hostname, tags: [] }]
}

function alertHostTargets(item) {
  return Array.isArray(item.hostTargets) && item.hostTargets.length ? item.hostTargets : fallbackHostTargets(item)
}

function HostTargetTags({ item }) {
  const hosts = alertHostTargets(item)
  if (!hosts.length) return null
  const visibleHosts = hosts.slice(0, 3)
  const remaining = hosts.length - visibleHosts.length
  return (
    <>
      {visibleHosts.map((host) => (
        <span key={host.id || host.ip || host.hostname}>
          <Tag color="geekblue">IP {host.ip || host.hostname}</Tag>
          {[host.group, ...(host.tags || [])].filter(Boolean).slice(0, 3).map((label) => <Tag key={`${host.id}-${label}`}>{label}</Tag>)}
        </span>
      ))}
      {remaining > 0 && <Tag>+{remaining} 台</Tag>}
    </>
  )
}

function HostTargetSummary({ item }) {
  const hosts = alertHostTargets(item)
  const labelHosts = hosts.slice(0, 3).map((host) => ({
    id: host.id || host.ip || host.hostname,
    labels: [host.group, ...(host.tags || [])].filter(Boolean).slice(0, 4),
  })).filter((host) => host.labels.length)
  if (!labelHosts.length) return null
  return (
    <Flex gap={6} align="center" wrap>
      <Typography.Text type="secondary">主机：</Typography.Text>
      {labelHosts.map((host) => (
        <Flex key={host.id} gap={4} align="center" wrap>
          {host.labels.map((label) => <Tag key={`${host.id}-${label}`}>{label}</Tag>)}
        </Flex>
      ))}
    </Flex>
  )
}

export default function AlertList({ alerts = [], showActions = false, diagnosingId, onDiagnose, onAcknowledge, onResolve, onDetail, pagination, onPageChange }) {
  const paginationNode = pagination ? (
    <Flex justify="end">
      <Pagination
        current={pagination.page}
        pageSize={pagination.pageSize}
        total={pagination.total}
        showSizeChanger
        showTotal={(total) => `共 ${total} 条告警`}
        onChange={onPageChange}
      />
    </Flex>
  ) : null

  if (!alerts.length) {
    return (
      <Flex vertical gap={12}>
        <Empty description="暂无告警" />
        {paginationNode}
      </Flex>
    )
  }

  return (
    <Flex vertical gap={12}>
      {alerts.map((item) => (
        <Card key={item.id} size="small" className="alert-list-item" style={{ opacity: item.isSuppressed ? 0.68 : 1 }}>
          <Flex justify="space-between" align="center" gap={16} wrap>
            <Flex vertical gap={8} style={{ minWidth: 0, flex: 1 }}>
              <Flex gap={8} align="center" wrap>
                <Tag color={levelColor[item.level]}>{item.level}</Tag>
                <Typography.Text strong>{item.title || item.service}</Typography.Text>
                <Typography.Text type="secondary">{item.time}</Typography.Text>
                <Tag color={statusColor[item.status]}>{item.status}</Tag>
                <HostTargetTags item={item} />
                <Tag>{item.source || '平台'}</Tag>
                {item.occurrenceCount > 1 && <Tag color="magenta">重复 {item.occurrenceCount} 次</Tag>}
                {item.isSuppressed && <Tag color="purple">已抑制</Tag>}
              </Flex>
              <Typography.Text>{item.content}</Typography.Text>
              <Flex gap={12} wrap>
                <Typography.Text type="secondary">服务/范围：{item.service}</Typography.Text>
                <Typography.Text type="secondary">处理人：{item.owner}</Typography.Text>
                {item.suppressionReason && <Typography.Text type="secondary">抑制原因：{item.suppressionReason}</Typography.Text>}
              </Flex>
            </Flex>
            {showActions && (
              <Flex gap={8} wrap>
                <Button onClick={() => onDetail?.(item)}>详情</Button>
                <Button type="primary" loading={diagnosingId === item.id} onClick={() => onDiagnose?.(item)}>
                  AI 诊断
                </Button>
                <PermissionGate permission={PERMISSIONS.ALERTS_MANAGE}>
                  <Button onClick={() => onAcknowledge?.(item.id)} disabled={item.status === '已解决'}>
                    确认
                  </Button>
                </PermissionGate>
                <PermissionGate permission={PERMISSIONS.ALERTS_MANAGE}>
                  <Button onClick={() => onResolve?.(item.id)} disabled={item.status === '已解决'}>
                    解决
                  </Button>
                </PermissionGate>
              </Flex>
            )}
          </Flex>
        </Card>
      ))}
      {paginationNode}
    </Flex>
  )
}
