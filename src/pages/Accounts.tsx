import { DeleteOutlined, EditOutlined, KeyOutlined, PlusOutlined, SafetyCertificateOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Checkbox, Form, Input, Modal, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from 'antd'
import { useEffect, useMemo, useState } from 'react'
import type { ColumnsType } from 'antd/es/table'
import { ROLE_LABELS, type Permission } from '../config/permissions'
import { useAccountStore } from '../stores/accountStore'
import { useAuthStore } from '../stores/authStore'
import type { AccountFormValues, AccountUser } from '../types/account'

export default function Accounts() {
  const [form] = Form.useForm<AccountFormValues>()
  const [passwordForm] = Form.useForm<{ password: string; confirmPassword: string }>()
  const { accounts, metadata, loading, saving, load, saveAccount, toggleAccount, resetPassword, removeAccount } = useAccountStore()
  const currentUser = useAuthStore((state) => state.user)
  const [editing, setEditing] = useState<AccountUser>()
  const [modalOpen, setModalOpen] = useState(false)
  const [resetting, setResetting] = useState<AccountUser>()

  useEffect(() => {
    void load()
  }, [load])

  const stats = useMemo(() => {
    const enabled = accounts.filter((account) => account.enabled).length
    const admins = accounts.filter((account) => account.role === 'admin').length
    return { total: accounts.length, enabled, admins, disabled: accounts.length - enabled }
  }, [accounts])

  const openCreate = () => {
    setEditing(undefined)
    form.resetFields()
    form.setFieldsValue({ role: 'viewer', enabled: true, customPermissions: [], title: '平台用户' })
    setModalOpen(true)
  }

  const openEdit = (account: AccountUser) => {
    setEditing(account)
    form.setFieldsValue({
      displayName: account.displayName,
      role: account.role,
      title: account.title,
      enabled: account.enabled,
      customPermissions: account.customPermissions,
    })
    setModalOpen(true)
  }

  const handleSave = async () => {
    const values = await form.validateFields()
    await saveAccount(editing?.id, values)
    message.success(editing ? '账号已更新' : '账号已创建')
    setModalOpen(false)
  }

  const handleResetPassword = async () => {
    if (!resetting) return
    const values = await passwordForm.validateFields()
    await resetPassword(resetting.id, values.password)
    message.success('密码已重置')
    setResetting(undefined)
    passwordForm.resetFields()
  }

  const handleDelete = (account: AccountUser) => {
    Modal.confirm({
      title: `删除账号 ${account.username}？`,
      content: '删除后该账号将无法登录，审计记录仍会保留。',
      okText: '删除',
      okButtonProps: { danger: true },
      cancelText: '取消',
      onOk: async () => {
        await removeAccount(account.id)
        message.success('账号已删除')
      },
    })
  }

  const columns: ColumnsType<AccountUser> = [
    {
      title: '账号',
      dataIndex: 'username',
      render: (_, account) => (
        <Space direction="vertical" size={0}>
          <Typography.Text strong>{account.username}</Typography.Text>
          <Typography.Text type="secondary">{account.displayName}</Typography.Text>
        </Space>
      ),
    },
    { title: '角色', dataIndex: 'role', render: (role) => <Tag color={role === 'admin' ? 'red' : 'blue'}>{ROLE_LABELS[role]}</Tag> },
    { title: '岗位', dataIndex: 'title' },
    { title: '状态', dataIndex: 'enabled', render: (enabled) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '禁用'}</Tag> },
    { title: '有效权限', dataIndex: 'permissions', render: (permissions: Permission[]) => permissions.length },
    { title: '额外权限', dataIndex: 'customPermissions', render: (permissions: Permission[]) => permissions.length },
    { title: '更新时间', dataIndex: 'updatedAt' },
    {
      title: '操作',
      render: (_, account) => (
        <Space wrap>
          <Button size="small" icon={<EditOutlined />} onClick={() => openEdit(account)}>编辑</Button>
          <Button size="small" icon={<KeyOutlined />} onClick={() => setResetting(account)}>重置密码</Button>
          <Switch
            checked={account.enabled}
            checkedChildren="启用"
            unCheckedChildren="禁用"
            disabled={account.id === currentUser?.id}
            onChange={(enabled) => void toggleAccount(account.id, enabled)}
          />
          <Button size="small" danger icon={<DeleteOutlined />} disabled={account.id === currentUser?.id} onClick={() => handleDelete(account)}>删除</Button>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
          <div>
            <Typography.Title level={4} style={{ marginTop: 0 }}>账号权限管理</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              管理后台登录账号、角色和额外权限，所有变更由后端持久化并进行权限校验。
            </Typography.Paragraph>
          </div>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增账号</Button>
        </Space>
      </Card>

      <Space size="large" wrap>
        <Card><Statistic title="账号总数" value={stats.total} /></Card>
        <Card><Statistic title="启用账号" value={stats.enabled} valueStyle={{ color: '#16a34a' }} /></Card>
        <Card><Statistic title="管理员" value={stats.admins} valueStyle={{ color: '#dc2626' }} /></Card>
        <Card><Statistic title="禁用账号" value={stats.disabled} /></Card>
      </Space>

      <Alert type="info" showIcon message="禁用或删除账号会让旧 token 在下一次请求时失效；不能禁用或删除当前账号，也不能移除最后一个启用管理员。" />

      <Card>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={accounts} pagination={{ pageSize: 8 }} />
      </Card>

      <Modal
        title={editing ? '编辑账号' : '新增账号'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        width={760}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" requiredMark={false}>
          {!editing && (
            <>
              <Form.Item name="username" label="用户名" rules={[{ required: true, message: '请输入用户名' }, { min: 2, message: '用户名至少 2 位' }]}>
                <Input placeholder="例如 ops.viewer" />
              </Form.Item>
              <Form.Item name="password" label="初始密码" rules={[{ required: true, message: '请输入初始密码' }, { min: 8, message: '密码至少 8 位' }]}>
                <Input.Password placeholder="至少 8 位" />
              </Form.Item>
            </>
          )}
          <Form.Item name="displayName" label="显示名" rules={[{ required: true, message: '请输入显示名' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="title" label="岗位" rules={[{ required: true, message: '请输入岗位' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色" rules={[{ required: true, message: '请选择角色' }]}>
            <Select options={metadata?.roles.map((role) => ({ label: role.label, value: role.value }))} />
          </Form.Item>
          <Form.Item name="enabled" label="启用状态" valuePropName="checked">
            <Switch checkedChildren="启用" unCheckedChildren="禁用" disabled={editing?.id === currentUser?.id} />
          </Form.Item>
          <Form.Item name="customPermissions" label="额外权限">
            <Checkbox.Group style={{ width: '100%' }}>
              <Space direction="vertical" style={{ width: '100%' }}>
                {metadata?.permissions.map((permission) => (
                  <Checkbox key={permission.key} value={permission.key}>
                    <Space>
                      <span>{permission.label}</span>
                      <Typography.Text type="secondary">{permission.key}</Typography.Text>
                    </Space>
                  </Checkbox>
                ))}
              </Space>
            </Checkbox.Group>
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`重置密码${resetting ? `：${resetting.username}` : ''}`}
        open={Boolean(resetting)}
        onCancel={() => setResetting(undefined)}
        onOk={handleResetPassword}
        confirmLoading={saving}
        destroyOnHidden
      >
        <Form form={passwordForm} layout="vertical" requiredMark={false}>
          <Form.Item name="password" label="新密码" rules={[{ required: true, message: '请输入新密码' }, { min: 8, message: '密码至少 8 位' }]}>
            <Input.Password />
          </Form.Item>
          <Form.Item
            name="confirmPassword"
            label="确认密码"
            dependencies={['password']}
            rules={[
              { required: true, message: '请确认新密码' },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  if (!value || getFieldValue('password') === value) return Promise.resolve()
                  return Promise.reject(new Error('两次输入的密码不一致'))
                },
              }),
            ]}
          >
            <Input.Password />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
