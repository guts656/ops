import { Button, Card, Flex, Form, Input, InputNumber, Modal, Space, Table, Tag, Typography } from 'antd'
import { useState } from 'react'
import PermissionGate from '../auth/PermissionGate'
import { PERMISSIONS } from '../../config/permissions'

export default function AlertNoisePanel({ stats, records, loading, onRefresh, onSuppress, onUnsuppress }) {
  const [open, setOpen] = useState(false)
  const [form] = Form.useForm()

  const columns = [
    { title: '来源', dataIndex: 'source', width: 120 },
    { title: '标题', dataIndex: 'title', ellipsis: true },
    { title: '服务', dataIndex: 'service', width: 140 },
    { title: '级别', dataIndex: 'level', width: 90, render: (level) => <Tag>{level}</Tag> },
    { title: '重复次数', dataIndex: 'occurrenceCount', width: 100 },
    { title: '抑制原因', dataIndex: 'suppressionReason', ellipsis: true },
    { title: '最后出现', dataIndex: 'lastOccurrenceAt', width: 180 },
    {
      title: '操作',
      width: 100,
      render: (_, record) => (
        <PermissionGate permission={PERMISSIONS.ALERTS_MANAGE}>
          <Button size="small" onClick={() => onUnsuppress?.(record.fingerprint)}>恢复</Button>
        </PermissionGate>
      ),
    },
  ]

  const submit = async () => {
    const values = await form.validateFields()
    await onSuppress?.(values)
    form.resetFields()
    setOpen(false)
  }

  return (
    <Space direction="vertical" size="middle" style={{ width: '100%' }}>
      <Card size="small">
        <Flex justify="space-between" align="center" wrap gap={12}>
          <Space wrap>
            <Typography.Text>指纹数：{stats?.totalFingerprints ?? 0}</Typography.Text>
            <Typography.Text>重复次数：{stats?.duplicateOccurrences ?? 0}</Typography.Text>
            <Typography.Text>已抑制：{stats?.suppressedFingerprints ?? 0}</Typography.Text>
            <Typography.Text>降噪率：{stats?.noiseReductionRate ?? 0}%</Typography.Text>
          </Space>
          <Space>
            <Button onClick={onRefresh}>刷新</Button>
            <PermissionGate permission={PERMISSIONS.ALERTS_MANAGE}>
              <Button type="primary" onClick={() => setOpen(true)}>手动抑制</Button>
            </PermissionGate>
          </Space>
        </Flex>
      </Card>
      <Table rowKey="fingerprint" loading={loading} columns={columns} dataSource={records} pagination={{ pageSize: 8 }} />
      <Modal title="手动抑制告警指纹" open={open} onOk={submit} onCancel={() => setOpen(false)} destroyOnHidden>
        <Form form={form} layout="vertical">
          <Form.Item name="fingerprint" label="告警指纹" rules={[{ required: true, message: '请输入告警指纹' }]}>
            <Input placeholder="从告警详情中复制 fingerprint" />
          </Form.Item>
          <Form.Item name="reason" label="抑制原因" rules={[{ required: true, message: '请输入抑制原因' }]}>
            <Input.TextArea rows={3} placeholder="说明为什么需要抑制这类告警" />
          </Form.Item>
          <Form.Item name="durationMinutes" label="抑制时长（分钟，可选）">
            <InputNumber min={1} style={{ width: '100%' }} placeholder="不填表示长期抑制" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  )
}
