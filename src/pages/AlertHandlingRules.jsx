import { Button, Card, Form, Input, InputNumber, Modal, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import { useEffect, useState } from 'react'
import PermissionGate from '../components/auth/PermissionGate'
import { PERMISSIONS } from '../config/permissions'
import { useAlertHandlingStore } from '../stores/alertHandlingStore'

const levels = ['紧急', '严重', '警告', '提示']
const sources = ['prometheus', 'zabbix', 'grafana', 'generic', '日志监控', '平台']

export default function AlertHandlingRules() {
  const { rules, selfHealingRules, loading, saving, load, save, remove, toggle } = useAlertHandlingStore()
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form] = Form.useForm()

  useEffect(() => {
    void load()
  }, [load])

  const openEditor = (rule) => {
    setEditing(rule)
    form.setFieldsValue(rule || { enabled: true, priority: 100, cooldownMinutes: 30, autoExecute: false, matchers: {} })
    setOpen(true)
  }

  const submit = async () => {
    const values = await form.validateFields()
    await save({ ...values, matchers: {} }, editing?.id)
    message.success(editing ? '映射规则已更新' : '映射规则已创建')
    setOpen(false)
    setEditing(null)
    form.resetFields()
  }

  const columns = [
    { title: '规则名称', dataIndex: 'name', ellipsis: true },
    { title: '优先级', dataIndex: 'priority', width: 90 },
    { title: '来源', dataIndex: 'alertSource', width: 120, render: (v) => v || '任意' },
    { title: '级别', dataIndex: 'alertLevel', width: 90, render: (v) => v ? <Tag color="red">{v}</Tag> : '任意' },
    { title: '标题包含', dataIndex: 'titlePattern', ellipsis: true, render: (v) => v || '-' },
    { title: '服务包含', dataIndex: 'servicePattern', ellipsis: true, render: (v) => v || '-' },
    { title: '自愈规则', dataIndex: 'selfHealingRuleName', ellipsis: true },
    { title: '冷却', dataIndex: 'cooldownMinutes', width: 90, render: (v) => `${v} 分钟` },
    {
      title: '启用',
      dataIndex: 'enabled',
      width: 90,
      render: (_, rule) => (
        <PermissionGate permission={PERMISSIONS.ALERT_HANDLING_MANAGE}>
          <Switch checked={rule.enabled} onChange={() => toggle(rule)} />
        </PermissionGate>
      ),
    },
    {
      title: '操作',
      width: 150,
      render: (_, rule) => (
        <Space>
          <PermissionGate permission={PERMISSIONS.ALERT_HANDLING_MANAGE}>
            <Button size="small" onClick={() => openEditor(rule)}>编辑</Button>
            <Button size="small" danger onClick={() => remove(rule.id)}>删除</Button>
          </PermissionGate>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card>
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <Typography.Title level={3}>告警自动处理</Typography.Title>
            <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
              将 Prometheus、Zabbix、Grafana 或日志监控告警匹配到已有自愈规则。当前为安全模式，只生成计划执行记录。
            </Typography.Paragraph>
          </div>
          <PermissionGate permission={PERMISSIONS.ALERT_HANDLING_MANAGE}>
            <Button type="primary" onClick={() => openEditor(null)}>新增映射</Button>
          </PermissionGate>
        </div>
      </Card>
      <Card title="映射规则">
        <Table rowKey="id" loading={loading} columns={columns} dataSource={rules} pagination={{ pageSize: 10 }} />
      </Card>
      <Modal title={editing ? '编辑映射规则' : '新增映射规则'} open={open} onOk={submit} confirmLoading={saving} onCancel={() => setOpen(false)} destroyOnHidden width={720}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input /></Form.Item>
          <Form.Item name="description" label="描述"><Input.TextArea rows={2} /></Form.Item>
          <Space wrap style={{ width: '100%' }}>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="priority" label="优先级"><InputNumber min={1} /></Form.Item>
            <Form.Item name="cooldownMinutes" label="冷却分钟"><InputNumber min={0} /></Form.Item>
            <Form.Item name="autoExecute" label="自动计划" valuePropName="checked"><Switch /></Form.Item>
          </Space>
          <Form.Item name="selfHealingRuleId" label="自愈规则" rules={[{ required: true, message: '请选择自愈规则' }]}>
            <Select options={selfHealingRules.map((rule) => ({ label: rule.name, value: rule.id }))} />
          </Form.Item>
          <Space wrap style={{ width: '100%' }}>
            <Form.Item name="alertSource" label="告警来源"><Select allowClear style={{ width: 160 }} options={sources.map((source) => ({ label: source, value: source }))} /></Form.Item>
            <Form.Item name="alertLevel" label="告警级别"><Select allowClear style={{ width: 140 }} options={levels.map((level) => ({ label: level, value: level }))} /></Form.Item>
            <Form.Item name="titlePattern" label="标题包含"><Input style={{ width: 180 }} /></Form.Item>
            <Form.Item name="servicePattern" label="服务包含"><Input style={{ width: 180 }} /></Form.Item>
          </Space>
        </Form>
      </Modal>
    </Space>
  )
}
