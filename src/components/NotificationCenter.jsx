import { BellOutlined } from '@ant-design/icons'
import { Badge, Button, Drawer, Empty, List, Space, Tag, Typography } from 'antd'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useNotificationStore } from '../stores/notificationStore'
import { getRealtimeSocket } from '../utils/realtime'

const levelColor = { info: 'blue', success: 'green', warning: 'gold', error: 'red' }
const typeLabel = { alert: '告警', self_healing: '自愈', webhook: 'Webhook', system: '系统' }

export default function NotificationCenter() {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const { notifications, unreadCount, loading, load, markRead, markAllRead, prepend } = useNotificationStore()

  useEffect(() => {
    void load()
    const socket = getRealtimeSocket()
    socket?.emit('notification:subscribe')
    socket?.on('notification:new', prepend)
    return () => socket?.off('notification:new', prepend)
  }, [load, prepend])

  const handleClick = async (item) => {
    if (!item.readAt) await markRead(item.id)
    if (item.entityType === 'alert' && item.entityId) navigate('/alerts')
    if (item.entityType === 'selfHealingExecution') navigate('/self-healing')
    if (item.entityType === 'healthReport' && item.entityId) navigate(`/ai?reportId=${item.entityId}`)
    setOpen(false)
  }

  return (
    <>
      <Badge count={unreadCount} size="small">
        <Button type="text" icon={<BellOutlined />} onClick={() => setOpen(true)} />
      </Badge>
      <Drawer
        title="通知中心"
        open={open}
        onClose={() => setOpen(false)}
        width={420}
        extra={<Button size="small" onClick={markAllRead} disabled={!unreadCount}>全部已读</Button>}
      >
        <List
          loading={loading}
          dataSource={notifications}
          locale={{ emptyText: <Empty description="暂无通知" /> }}
          renderItem={(item) => (
            <List.Item style={{ cursor: 'pointer', opacity: item.readAt ? 0.65 : 1 }} onClick={() => void handleClick(item)}>
              <List.Item.Meta
                title={(
                  <Space wrap>
                    <Typography.Text strong={!item.readAt}>{item.title}</Typography.Text>
                    <Tag color={levelColor[item.level]}>{typeLabel[item.type] || item.type}</Tag>
                  </Space>
                )}
                description={(
                  <Space direction="vertical" size={4}>
                    <Typography.Text type="secondary">{item.content}</Typography.Text>
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>{item.createdAt}</Typography.Text>
                  </Space>
                )}
              />
            </List.Item>
          )}
        />
      </Drawer>
    </>
  )
}
