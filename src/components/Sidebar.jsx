import { Menu } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import { navigationItems } from '../config/navigation'
import { useAuthStore } from '../stores/authStore'

export default function Sidebar() {
  const navigate = useNavigate()
  const location = useLocation()
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const selectedKey = location.pathname.startsWith('/hosts') ? '/hosts' : location.pathname
  const items = navigationItems
    .filter((item) => hasPermission(item.permission))
    .map(({ key, icon, label }) => ({ key, icon, label }))

  return (
    <Menu
      theme="dark"
      mode="inline"
      selectedKeys={[selectedKey]}
      items={items}
      onClick={({ key }) => navigate(key)}
    />
  )
}
