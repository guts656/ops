import { LockOutlined, SafetyCertificateOutlined, UserOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Form, Input, Space, Tag, Typography, message } from 'antd'
import { useState } from 'react'
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export default function Login() {
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { isAuthenticated, login, getDefaultPath } = useAuthStore()
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const sanitizeRedirect = (value) => {
    if (!value) return getDefaultPath()
    if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return getDefaultPath()
    return value
  }
  const redirect = sanitizeRedirect(searchParams.get('redirect'))

  if (isAuthenticated) return <Navigate to={redirect} replace />

  const handleSubmit = async (values) => {
    setError('')
    setLoading(true)
    try {
      await login(values.username, values.password)
      message.success('登录成功')
      navigate(redirect, { replace: true })
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="login-page">
      <div className="login-glow login-glow-a" />
      <div className="login-glow login-glow-b" />
      <section className="login-shell">
        <div className="login-brand-panel">
          <div className="brand-logo login-brand-logo">OP</div>
          <Tag color="processing" className="login-kicker">Access Control</Tag>
          <Typography.Title className="login-title">Ops Platform</Typography.Title>
          <Typography.Paragraph className="login-copy">
            统一运维平台登录入口。账号、角色和权限由管理员在后台分配，关键操作会进行服务端权限校验和审计记录。
          </Typography.Paragraph>
          <div className="login-signal-grid">
            <span>路由守卫</span>
            <span>角色菜单</span>
            <span>操作权限</span>
            <span>审计身份</span>
          </div>
        </div>

        <Card className="login-card">
          <Space direction="vertical" size="large" style={{ width: '100%' }}>
            <div>
              <Typography.Title level={2} style={{ marginBottom: 6 }}>账号登录</Typography.Title>
              <Typography.Text type="secondary">请输入管理员分配的用户名和密码。</Typography.Text>
            </div>

            {error && <Alert type="error" showIcon message={error} />}
            <Alert type="info" showIcon message="账号和权限由后端校验，请使用已分配的账号登录。" />

            <Form form={form} layout="vertical" onFinish={handleSubmit} requiredMark={false}>
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }]}>
                <Input size="large" prefix={<UserOutlined />} placeholder="请输入用户名" />
              </Form.Item>
              <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
                <Input.Password size="large" prefix={<LockOutlined />} placeholder="请输入密码" />
              </Form.Item>
              <Button type="primary" htmlType="submit" size="large" block loading={loading} icon={<SafetyCertificateOutlined />}>
                进入运维后台
              </Button>
            </Form>
          </Space>
        </Card>
      </section>
    </main>
  )
}
