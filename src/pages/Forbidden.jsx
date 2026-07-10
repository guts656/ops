import { Button, Card, Result, Space } from 'antd'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

export default function Forbidden() {
  const navigate = useNavigate()
  const { getDefaultPath, logout, user } = useAuthStore()

  return (
    <Card>
      <Result
        status="403"
        title="权限不足"
        subTitle={`${user?.displayName ?? '当前账号'} 没有访问该页面或执行该操作的权限。`}
        extra={(
          <Space>
            <Button type="primary" onClick={() => navigate(getDefaultPath(), { replace: true })}>返回可访问首页</Button>
            <Button onClick={() => { logout(); navigate('/login', { replace: true }) }}>切换账号</Button>
          </Space>
        )}
      />
    </Card>
  )
}
