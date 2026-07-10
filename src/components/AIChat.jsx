import { SendOutlined } from '@ant-design/icons'
import { Avatar, Button, Card, Input, List, Space, Typography } from 'antd'
import { useState } from 'react'
import { sendChatMessage } from '../api/client'
import { initialMessages } from '../utils/mock'

export default function AIChat() {
  const [messages, setMessages] = useState(initialMessages)
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)

  async function send() {
    const content = input.trim()
    if (!content) return
    setInput('')
    setMessages((items) => [...items, { role: 'user', content }])
    setLoading(true)
    const reply = await sendChatMessage(content)
    setMessages((items) => [...items, reply])
    setLoading(false)
  }

  return (
    <Card className="chat-card">
      <List
        className="chat-list"
        dataSource={messages}
        renderItem={(message) => (
          <List.Item className={message.role === 'user' ? 'chat-item user' : 'chat-item'}>
            <Space align="start">
              <Avatar>{message.role === 'user' ? '你' : 'AI'}</Avatar>
              <div className="chat-bubble">
                <Typography.Text>{message.content}</Typography.Text>
              </div>
            </Space>
          </List.Item>
        )}
      />
      <Space.Compact style={{ width: '100%', marginTop: 16 }}>
        <Input.TextArea
          autoSize={{ minRows: 1, maxRows: 4 }}
          value={input}
          onChange={(event) => setInput(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault()
              send()
            }
          }}
          placeholder="输入你的运维问题，例如：帮我分析 payment-service 告警"
        />
        <Button type="primary" icon={<SendOutlined />} loading={loading} onClick={send}>
          发送
        </Button>
      </Space.Compact>
    </Card>
  )
}
