import { AlertOutlined, BellOutlined, CheckCircleOutlined, StopOutlined } from '@ant-design/icons'
import { Card, Col, Row, Statistic } from 'antd'

export default function AlertSummaryCards({ summary, noiseStats }) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic title="未解决告警" value={summary?.active ?? 0} prefix={<AlertOutlined />} valueStyle={{ color: (summary?.active ?? 0) > 0 ? '#ff4d4f' : '#52c41a' }} />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic title="今日新增" value={summary?.today ?? 0} prefix={<BellOutlined />} valueStyle={{ color: '#1677ff' }} />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic title="已解决" value={summary?.resolved ?? 0} prefix={<CheckCircleOutlined />} valueStyle={{ color: '#52c41a' }} />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={6}>
        <Card>
          <Statistic title="已抑制 / 降噪率" value={summary?.suppressed ?? 0} suffix={`/ ${noiseStats?.noiseReductionRate ?? 0}%`} prefix={<StopOutlined />} valueStyle={{ color: '#722ed1' }} />
        </Card>
      </Col>
    </Row>
  )
}
