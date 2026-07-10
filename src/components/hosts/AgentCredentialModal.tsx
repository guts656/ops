import { Form, Input, InputNumber, Modal, Radio } from 'antd'
import { useEffect, useState } from 'react'
import type { Host, HostConnectionValues } from '../../types/host'

interface Props {
  open: boolean
  title: string
  host?: Host
  loading?: boolean
  showApiBaseUrl?: boolean
  onCancel: () => void
  onSubmit: (values: HostConnectionValues) => Promise<void>
}

export default function AgentCredentialModal({ open, title, host, loading = false, showApiBaseUrl = false, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<HostConnectionValues>()
  const [authType, setAuthType] = useState('密码')
  const isWindows = host?.os === 'Windows'

  useEffect(() => {
    if (!open || !host) return
    const nextAuthType = isWindows ? '密码' : '密码'
    setAuthType(nextAuthType)
    const defaultApiBaseUrl = `${window.location.protocol}//${window.location.hostname}:3001`
    form.setFieldsValue({ sshUsername: host.owner, sshPort: host.sshPort || (isWindows ? 5985 : 22), authType: nextAuthType, apiBaseUrl: defaultApiBaseUrl })
  }, [form, host, isWindows, open])

  async function handleOk() {
    const values = await form.validateFields()
    await onSubmit(values)
  }

  return (
    <Modal title={title} open={open} onCancel={onCancel} onOk={handleOk} confirmLoading={loading} destroyOnHidden>
      <Form form={form} layout="vertical">
        <Form.Item name="sshUsername" label={isWindows ? 'WinRM 用户名' : 'SSH 用户名'} rules={[{ required: true, message: '请输入远程用户名' }]}>
          <Input />
        </Form.Item>
        <Form.Item name="sshPort" label={isWindows ? 'WinRM 端口' : 'SSH 端口'} rules={[{ required: true, message: '请输入端口' }]}>
          <InputNumber min={1} max={65535} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="authType" label="认证方式" rules={[{ required: true }]}>
          <Radio.Group onChange={(event) => setAuthType(event.target.value)}>
            <Radio.Button value="密码">密码</Radio.Button>
            <Radio.Button value="密钥" disabled={isWindows}>密钥</Radio.Button>
          </Radio.Group>
        </Form.Item>
        {showApiBaseUrl ? (
          <Form.Item name="apiBaseUrl" label="Agent 回连 API 地址" rules={[{ required: true, message: '请输入 Agent 回连 API 地址' }, { type: 'url', message: '请输入完整 URL，例如 http://10.126.92.235:3001' }]}>
            <Input placeholder="例如 http://10.126.92.235:3001" />
          </Form.Item>
        ) : null}
        {authType === '密码' ? (
          <Form.Item name="password" label={isWindows ? 'WinRM 密码' : 'SSH 密码'} rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password placeholder={isWindows ? 'Windows WinRM 当前仅支持密码认证；启用自动 Pull 时会加密保存' : '执行本次操作使用；启用自动 Pull 时会加密保存'} />
          </Form.Item>
        ) : (
          <Form.Item name="privateKey" label="SSH 私钥" rules={[{ required: true, message: '请输入 SSH 私钥' }]}>
            <Input.TextArea rows={4} placeholder="执行本次操作使用；启用自动 Pull 时会加密保存" />
          </Form.Item>
        )}
      </Form>
    </Modal>
  )
}
