import { LogoutOutlined, MenuFoldOutlined, MenuUnfoldOutlined, UserSwitchOutlined } from '@ant-design/icons'
import { Button, Dropdown, Layout, Space, Tag, Typography } from 'antd'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import RequireAuth from './components/auth/RequireAuth'
import RequirePermission from './components/auth/RequirePermission'
import Sidebar from './components/Sidebar'
import NotificationCenter from './components/NotificationCenter'
import { getPageMeta } from './config/navigation'
import { PERMISSIONS, ROLE_LABELS } from './config/permissions'
import Accounts from './pages/Accounts'
import AuditLogs from './pages/AuditLogs'
import BatchJobs from './pages/BatchJobs'
import AIAssistant from './pages/AIAssistant'
import Alerts from './pages/Alerts'
import AlertHandlingRules from './pages/AlertHandlingRules'
import Dashboard from './pages/Dashboard'
import ErrorBoundary from './components/ErrorBoundary'
import Forbidden from './pages/Forbidden'
import HostDetail from './pages/HostDetail'
import Hosts from './pages/Hosts'
import Inspection from './pages/Inspection'
import Login from './pages/Login'
import LogMonitoring from './pages/LogMonitoring'
import LogQuery from './pages/LogQuery'
import SelfHealingRules from './pages/SelfHealingRules'
import ServiceTopology from './pages/ServiceTopology'
import Settings from './pages/Settings'
import { useAppStore } from './stores/appStore'
import { useAuthStore } from './stores/authStore'

const { Header, Sider, Content } = Layout

function ProtectedRoute({ permission, children }) {
  return <RequirePermission permission={permission}>{children}</RequirePermission>
}

function MainLayout() {
  const { collapsed, toggleCollapsed } = useAppStore()
  const { user, logout, getDefaultPath } = useAuthStore()
  const location = useLocation()
  const navigate = useNavigate()
  const current = getPageMeta(location.pathname)
  const initials = user?.displayName?.slice(0, 2) ?? 'OP'

  const userMenuItems = [
    { key: 'profile', label: `${user?.displayName ?? '-'} · ${user ? ROLE_LABELS[user.role] : '-'}`, disabled: true, icon: <UserSwitchOutlined /> },
    { type: 'divider' },
    { key: 'logout', label: '退出登录', icon: <LogoutOutlined />, danger: true },
  ]

  const handleUserMenu = ({ key }) => {
    if (key === 'logout') {
      logout()
      navigate('/login', { replace: true })
    }
  }

  return (
    <Layout className="app-layout">
      <Sider width={248} collapsed={collapsed} className="app-sider">
        <div className="brand">
          <div className="brand-logo">OP</div>
          {!collapsed && (
            <div>
              <Typography.Title level={4} style={{ margin: 0 }}>
                Ops Platform
              </Typography.Title>
              <Typography.Text type="secondary">统一运维平台</Typography.Text>
            </div>
          )}
        </div>
        <Sidebar />
      </Sider>
      <Layout>
        <Header className="app-header">
          <Space>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={toggleCollapsed}
            />
            <div>
              <Typography.Title level={3} style={{ margin: 0 }}>
                {current.title}
              </Typography.Title>
              <Typography.Text type="secondary">{current.subtitle}</Typography.Text>
            </div>
          </Space>
          <Space>
            <NotificationCenter />
            <Typography.Text type="secondary">后端数据源</Typography.Text>
            {user && <Tag color="blue">{ROLE_LABELS[user.role]}</Tag>}
            <Dropdown menu={{ items: userMenuItems, onClick: handleUserMenu }} placement="bottomRight">
              <button type="button" className="user-chip">
                <span className="user-avatar">{initials}</span>
                <span className="user-chip-name">{user?.displayName}</span>
              </button>
            </Dropdown>
          </Space>
        </Header>
        <Content className="app-content">
          <Routes>
            <Route path="/" element={<ProtectedRoute permission={PERMISSIONS.DASHBOARD_VIEW}><Dashboard /></ProtectedRoute>} />
            <Route path="/alerts" element={<ProtectedRoute permission={PERMISSIONS.ALERTS_VIEW}><Alerts /></ProtectedRoute>} />
            <Route path="/alert-handling" element={<ProtectedRoute permission={PERMISSIONS.ALERT_HANDLING_VIEW}><AlertHandlingRules /></ProtectedRoute>} />
            <Route path="/logs" element={<ProtectedRoute permission={PERMISSIONS.LOGS_VIEW}><LogQuery /></ProtectedRoute>} />
            <Route path="/log-monitoring" element={<ProtectedRoute permission={PERMISSIONS.LOGS_VIEW}><LogMonitoring /></ProtectedRoute>} />
            <Route path="/topology" element={<ProtectedRoute permission={PERMISSIONS.TOPOLOGY_VIEW}><ServiceTopology /></ProtectedRoute>} />
            <Route path="/hosts" element={<ProtectedRoute permission={PERMISSIONS.HOSTS_VIEW}><Hosts /></ProtectedRoute>} />
            <Route path="/hosts/:id" element={<ProtectedRoute permission={PERMISSIONS.HOSTS_VIEW}><HostDetail /></ProtectedRoute>} />
            <Route path="/accounts" element={<ProtectedRoute permission={PERMISSIONS.ACCOUNTS_MANAGE}><Accounts /></ProtectedRoute>} />
            <Route path="/audit-logs" element={<ProtectedRoute permission={PERMISSIONS.AUDIT_LOG_VIEW}><AuditLogs /></ProtectedRoute>} />
            <Route path="/self-healing" element={<ProtectedRoute permission={PERMISSIONS.SELF_HEALING_VIEW}><SelfHealingRules /></ProtectedRoute>} />
            <Route path="/batch-jobs" element={<ProtectedRoute permission={PERMISSIONS.BATCH_VIEW}><BatchJobs /></ProtectedRoute>} />
            <Route path="/ai" element={<ProtectedRoute permission={PERMISSIONS.AI_VIEW}><AIAssistant /></ProtectedRoute>} />
            <Route path="/inspection" element={<ProtectedRoute permission={PERMISSIONS.INSPECTION_VIEW}><Inspection /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute permission={PERMISSIONS.SETTINGS_VIEW}><Settings /></ProtectedRoute>} />
            <Route path="/403" element={<Forbidden />} />
            <Route path="*" element={<Navigate to={getDefaultPath()} replace />} />
          </Routes>
        </Content>
      </Layout>
    </Layout>
  )
}

export default function App() {
  return (
    <ErrorBoundary>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/*" element={<RequireAuth><MainLayout /></RequireAuth>} />
      </Routes>
    </ErrorBoundary>
  )
}
