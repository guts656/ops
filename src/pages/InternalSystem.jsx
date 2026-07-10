import { ExportOutlined, InfoCircleOutlined } from '@ant-design/icons'
import { Button, Card, Space, Typography } from 'antd'

const internalSystemUrl = 'http://172.29.20.81'

export default function InternalSystem() {
  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Typography.Title level={3}>内部系统</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              当前页面通过 iframe 内嵌访问内部地址：{internalSystemUrl}
            </Typography.Paragraph>
          </div>
          <Button type="primary" icon={<ExportOutlined />} onClick={() => window.open(internalSystemUrl, '_blank', 'noopener,noreferrer')}>
            新窗口打开
          </Button>
        </div>
      </Card>

      <Card>
        <div className="mb-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3 text-blue-100">
          <InfoCircleOutlined /> 如果下方页面无法显示，通常是目标系统禁止被 iframe 嵌入，需要在目标系统服务端允许当前运维平台域名访问。
        </div>
        <div className="internal-system-page">
          <iframe className="internal-system-frame" src={internalSystemUrl} title="内部系统" />
        </div>
      </Card>
    </Space>
  )
}
