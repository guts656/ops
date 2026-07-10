import { ArrowDownOutlined, ArrowUpOutlined, WarningOutlined } from '@ant-design/icons'
import { Card, Space, Statistic, Tag, Typography } from 'antd'

const trendIcon = {
  up: <ArrowUpOutlined />,
  down: <ArrowDownOutlined />,
  danger: <WarningOutlined />,
}

const trendColor = {
  up: 'success',
  down: 'success',
  danger: 'error',
}

export default function MetricsCard({ title, value, trend, trendType = 'up', color }) {
  return (
    <Card className="metric-card" styles={{ body: { minHeight: 148 } }}>
      <Space orientation="vertical" size={14} style={{ width: '100%' }}>
        <Typography.Text type="secondary">{title}</Typography.Text>
        <Statistic value={value} styles={{ content: { color, fontWeight: 800 } }} />
        <Tag color={trendColor[trendType]} icon={trendIcon[trendType]}>
          {trend}
        </Tag>
      </Space>
    </Card>
  )
}
