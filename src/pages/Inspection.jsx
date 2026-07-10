import { Button, Card, Input, List, Space, Tag, Typography } from 'antd'
import { useState } from 'react'
import { runInspection } from '../api/client'
import { inspectionTemplates } from '../utils/mock'

const statusColor = { 通过: 'green', 需关注: 'orange', 异常: 'red' }

export default function Inspection() {
  const [prompt, setPrompt] = useState(inspectionTemplates[0])
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)

  async function submit() {
    const text = prompt.trim()
    if (!text) return
    setLoading(true)
    const data = await runInspection(text)
    setResult(data)
    setLoading(false)
  }

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Typography.Title level={3}>智能巡检</Typography.Title>
        <Typography.Paragraph type="secondary">
          输入自然语言巡检目标，系统会基于 Mock 监控数据生成巡检结果。
        </Typography.Paragraph>
        <Space direction="vertical" style={{ width: '100%' }}>
          <Input.TextArea rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} />
          <Space wrap>
            {inspectionTemplates.map((template) => (
              <Button key={template} onClick={() => setPrompt(template)}>
                {template}
              </Button>
            ))}
          </Space>
          <Button type="primary" loading={loading} onClick={submit}>
            开始巡检
          </Button>
        </Space>
      </Card>

      {result && (
        <Card title="巡检结果">
          <Typography.Paragraph>{result.summary}</Typography.Paragraph>
          <List
            dataSource={result.items}
            renderItem={(item) => (
              <List.Item>
                <List.Item.Meta
                  title={
                    <Space>
                      <Typography.Text strong>{item.name}</Typography.Text>
                      <Tag color={statusColor[item.status]}>{item.status}</Tag>
                    </Space>
                  }
                  description={item.detail}
                />
              </List.Item>
            )}
          />
        </Card>
      )}
    </Space>
  )
}
