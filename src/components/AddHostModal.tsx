import { CheckCircleOutlined, CloseCircleOutlined, LinkOutlined } from '@ant-design/icons'
import { Alert, AutoComplete, Button, Form, Input, InputNumber, Modal, Progress, Radio, Select, Space, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import type { AddHostFormValues, BatchAddResult } from '../types/host'

interface Props {
  open: boolean
  groups: string[]
  tags: string[]
  batchResults: BatchAddResult[]
  onCancel: () => void
  onSubmit: (values: AddHostFormValues) => Promise<void>
  onTestConnection: (values: Partial<AddHostFormValues>) => Promise<{ success: boolean; hostname: string; os: 'Linux' | 'Windows'; osVersion?: string; message: string }>
}

export default function AddHostModal({ open, groups, tags, batchResults, onCancel, onSubmit, onTestConnection }: Props) {
  const [form] = Form.useForm<AddHostFormValues>()
  const [authType, setAuthType] = useState('密码')
  const os = Form.useWatch('os', form)
  const [submitting, setSubmitting] = useState(false)
  const [testing, setTesting] = useState(false)

  useEffect(() => {
    if (open) {
      form.setFieldsValue({ sshPort: 22, authType: '密码' })
      setAuthType('密码')
    } else {
      form.resetFields()
      setSubmitting(false)
      setTesting(false)
    }
  }, [form, open])

  useEffect(() => {
    if (!open) return
    if (os === 'Windows') {
      form.setFieldsValue({ sshPort: 5985, authType: '密码' })
      setAuthType('密码')
    }
    if (os === 'Linux') form.setFieldsValue({ sshPort: 22 })
  }, [form, open, os])

  const handleTest = async () => {
    const values = await form.validateFields(['ips', 'os', 'sshUsername', 'authType', 'password', 'privateKey', 'sshPort'])
    setTesting(true)
    try {
      const result = await onTestConnection(values)
      if (result.success) {
        form.setFieldsValue({ hostname: result.hostname, os: result.os, osVersion: result.osVersion })
        message.success(result.message)
      } else {
        message.error(result.message)
      }
    } finally {
      setTesting(false)
    }
  }

  const handleOk = async () => {
    const values = await form.validateFields()
    setSubmitting(true)
    try {
      await onSubmit(values)
    } catch (error) {
      message.error(error instanceof Error ? error.message : '新增主机失败')
    } finally {
      setSubmitting(false)
    }
  }

  const successCount = batchResults.filter((item) => item.status === '成功').length
  const percent = batchResults.length ? Math.round((successCount / batchResults.length) * 100) : 0

  return (
    <Modal width={760} open={open} title="新增主机" onCancel={onCancel} destroyOnClose footer={<Space><Button onClick={onCancel}>取消</Button><Button icon={<LinkOutlined />} loading={testing} onClick={handleTest}>测试连接</Button><Button type="primary" loading={submitting} onClick={handleOk}>提交纳管</Button></Space>}>
      <Alert type="info" showIcon style={{ marginBottom: 16 }} title="Linux 使用 SSH，Windows 使用 WinRM；提交纳管后会加密保存凭据，并自动启用 30 秒 Pull 采集 CPU、内存、磁盘。" />
      <Form form={form} layout="vertical">
        <Form.Item name="ips" label="主机 IP（多台换行分隔）" rules={[{ required: true, message: '请输入主机 IP' }]}>
          <Input.TextArea rows={4} placeholder={'10.16.1.31\n10.16.1.32'} />
        </Form.Item>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Form.Item name="hostname" label="主机名"><Input placeholder="不填则自动获取" /></Form.Item>
          <Form.Item name="os" label="操作系统" rules={[{ required: true, message: '请选择操作系统' }]}><Select options={['Linux', 'Windows'].map((value) => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="osVersion" label="系统版本"><Input placeholder="测试连接后自动识别" readOnly /></Form.Item>
          <Form.Item name="sshUsername" label={os === 'Windows' ? 'WinRM 用户名' : 'SSH 用户名'} rules={[{ required: true, message: '请输入远程用户名' }]}><Input /></Form.Item>
          <Form.Item name="sshPort" label={os === 'Windows' ? 'WinRM 端口' : 'SSH 端口'} rules={[{ required: true, message: '请输入端口' }]}><InputNumber min={1} max={65535} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="group" label="主机组" rules={[{ required: true, message: '请选择或输入主机组' }]}><AutoComplete options={groups.map((value) => ({ label: value, value }))} placeholder="选择或输入主机组" filterOption={(inputValue, option) => String(option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())} /></Form.Item>
          <Form.Item name="tags" label="标签"><Select mode="tags" options={tags.map((value) => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="authType" label="认证方式" rules={[{ required: true }]}><Radio.Group onChange={(event) => setAuthType(event.target.value)}><Radio.Button value="密码">密码</Radio.Button><Radio.Button value="密钥" disabled={os === 'Windows'}>密钥</Radio.Button></Radio.Group></Form.Item>
        </div>
        {authType === '密码' ? (
          <Form.Item name="password" label={os === 'Windows' ? 'WinRM 密码' : 'SSH 密码'} rules={[{ required: true, message: os === 'Windows' ? '请输入 WinRM 密码' : '请输入 SSH 密码' }]}><Input.Password placeholder={os === 'Windows' ? 'Windows 主机会加密保存，用于 WinRM 自动 Pull 和 Agent 管理' : 'Linux 主机会加密保存，用于自动 Pull 和 Agent 管理'} /></Form.Item>
        ) : (
          <Form.Item name="privateKey" label="SSH 私钥" rules={[{ required: true, message: '请输入 SSH 私钥' }]}><Input.TextArea rows={4} placeholder="Linux 主机会加密保存，用于自动 Pull 和 Agent 管理" /></Form.Item>
        )}
      </Form>

      {batchResults.length > 0 && (
        <div className="mt-4 rounded-xl border border-slate-700/70 bg-slate-950/30 p-4">
          <Progress percent={percent} status={batchResults.some((item) => item.status === '失败') ? 'exception' : percent === 100 ? 'success' : 'active'} />
          {batchResults.some((item) => item.status === '失败') ? <Alert type="warning" showIcon style={{ marginBottom: 12 }} title="部分主机已保存，但 Agent 安装异常；请根据下方结果进入详情页查看 Agent 任务日志。" /> : null}
          <Space direction="vertical" size={6} style={{ width: '100%' }}>
            {batchResults.map((item) => <Typography.Text key={item.ip} type={item.status === '失败' ? 'danger' : undefined}>{item.status === '失败' ? <CloseCircleOutlined /> : <CheckCircleOutlined />} {item.ip} · {item.status} · {item.message}</Typography.Text>)}
          </Space>
        </div>
      )}
    </Modal>
  )
}
