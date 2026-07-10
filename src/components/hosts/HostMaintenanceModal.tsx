import { Alert, Form, Input, Modal, Select } from 'antd'
import { useEffect } from 'react'
import type { Host, HostMaintenanceValues } from '../../types/host'

interface FormValues {
  reason: string
  durationMode?: 'manual' | '30' | '60' | '120' | '240' | '480'
  customMinutes?: number
}

interface Props {
  open: boolean
  host?: Host
  loading?: boolean
  onCancel: () => void
  onSubmit: (values: HostMaintenanceValues) => Promise<void>
}

export default function HostMaintenanceModal({ open, host, loading = false, onCancel, onSubmit }: Props) {
  const [form] = Form.useForm<FormValues>()

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({ reason: host?.maintenance.reason || '', durationMode: '60' })
  }, [form, host, open])

  async function handleOk() {
    const values = await form.validateFields()
    const minutes = values.durationMode === 'manual' ? values.customMinutes : Number(values.durationMode || 0)
    const until = minutes ? new Date(Date.now() + minutes * 60_000).toISOString() : undefined
    await onSubmit({ enabled: true, reason: values.reason, until })
  }

  return (
    <Modal title={`进入维护：${host?.hostname || ''}`} open={open} onCancel={onCancel} onOk={handleOk} confirmLoading={loading} destroyOnHidden>
      <Alert showIcon type="warning" style={{ marginBottom: 16 }} message="维护期间该主机关联告警不会创建或外发，但服务事件、日志、检查记录仍会保留。" />
      <Form form={form} layout="vertical">
        <Form.Item name="reason" label="维护原因" rules={[{ required: true, message: '请输入维护原因' }]}>
          <Input.TextArea rows={3} placeholder="例如：变更发布、系统升级、网络割接" />
        </Form.Item>
        <Form.Item name="durationMode" label="维护时长">
          <Select
            options={[
              { label: '30 分钟', value: '30' },
              { label: '1 小时', value: '60' },
              { label: '2 小时', value: '120' },
              { label: '4 小时', value: '240' },
              { label: '8 小时', value: '480' },
              { label: '手动结束', value: 'manual' },
            ]}
          />
        </Form.Item>
        <Form.Item noStyle shouldUpdate={(prev, next) => prev.durationMode !== next.durationMode}>
          {({ getFieldValue }) => getFieldValue('durationMode') === 'manual' ? null : undefined}
        </Form.Item>
      </Form>
    </Modal>
  )
}
