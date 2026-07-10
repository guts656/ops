import { Button, Card, Empty, Flex, Tag, Typography } from 'antd'
import PermissionGate from './auth/PermissionGate'
import { PERMISSIONS } from '../config/permissions'

const levelColor = { 紧急: 'red', 严重: 'orange', 警告: 'gold', 提示: 'cyan' }
const statusColor = { 待处理: 'red', 处理中: 'blue', 已解决: 'green' }

export default function AlertList({ alerts = [], showActions = false, diagnosingId, onDiagnose, onAcknowledge, onResolve, onDetail }) {
  if (!alerts.length) return <Empty description="暂无告警" />

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
    </Flex>
  )
}
