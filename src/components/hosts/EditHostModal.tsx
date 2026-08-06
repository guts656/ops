import { AutoComplete, Form, Input, InputNumber, Modal, Select } from 'antd'
import { useEffect } from 'react'
import type { EditHostValues, Host } from '../../types/host'
import EditableTagsInput from './EditableTagsInput'

interface Props {
  open: boolean
  host?: Host
  groups: string[]
  tags: string[]
  loading: boolean
  onCancel: () => void
  onSubmit: (values: EditHostValues) => Promise<void>
}

export default function EditHostModal({ open, host, groups, tags, loading, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<EditHostValues>()

  useEffect(() => {
    if (open && host) {
      form.setFieldsValue({
        hostname: host.hostname,
        os: host.os,
        osVersion: host.osVersion,
        sshPort: host.sshPort,
        group: host.group,
        tags: host.tags,
      })
    }
    if (!open) form.resetFields()
  }, [form, host, open])

  const handleOk = async () => {
    const values = await form.validateFields()
    await onSubmit(values)
  }

  return (
    <Modal width={680} open={open} title="编辑主机" onCancel={onCancel} onOk={handleOk} confirmLoading={loading} destroyOnClose>
      <Form form={form} layout="vertical">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Form.Item name="hostname" label="主机名" rules={[{ required: true, message: '请输入主机名' }]}><Input /></Form.Item>
          <Form.Item name="os" label="操作系统" rules={[{ required: true, message: '请选择操作系统' }]}><Select options={['Linux', 'Windows'].map((value) => ({ label: value, value }))} /></Form.Item>
          <Form.Item name="osVersion" label="系统版本" rules={[{ required: true, message: '请输入系统版本' }]}><Input /></Form.Item>
          <Form.Item name="sshPort" label="远程端口" rules={[{ required: true, message: '请输入远程端口' }]}><InputNumber min={1} max={65535} style={{ width: '100%' }} /></Form.Item>
          <Form.Item name="group" label="主机组" rules={[{ required: true, message: '请选择或输入主机组' }]}><AutoComplete options={groups.map((value) => ({ label: value, value }))} placeholder="选择或输入主机组" filterOption={(inputValue, option) => String(option?.value ?? '').toLowerCase().includes(inputValue.toLowerCase())} /></Form.Item>
          <Form.Item name="tags" label="标签"><EditableTagsInput options={tags} /></Form.Item>
        </div>
      </Form>
    </Modal>
  )
}
