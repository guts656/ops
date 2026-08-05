import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Alert, AutoComplete, Button, Card, Checkbox, Drawer, Form, Input, InputNumber, Radio, Select, Space, Switch, Typography } from 'antd'
import { useEffect } from 'react'

const metricOptions = ['cpu_usage', 'memory_usage', 'disk_usage', 'ERROR', 'WARN', 'INFO', 'DEBUG', 'log_count', 'event_count', 'service_not_running', 'service_failed'].map((value) => ({ value }))
const serviceOptions = ['主机ID/hostname/IP', 'nginx.service', 'postgresql.service', 'payment-api', 'system'].map((value) => ({ value }))

const defaultRule = {
  enabled: true,
  autoExecute: false,
  executionMode: 'safe',
  priority: 'P1',
  logic: 'AND',
  conditions: [{ dataSource: '指标', metric: 'cpu_usage', service: '主机ID/hostname/IP', operator: '>', threshold: 85, windowValue: 5, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' }],
  actions: [{ type: '重启服务', target: '目标服务名', retries: 1, cooldown: 10 }],
  notification: { channels: [], receivers: '', template: '规则 {{ruleName}} 已触发，服务 {{service}} 当前值 {{value}}。' },
}

const templates = [
  {
    label: '服务停止 → 启动服务（安全模式记录）',
    value: 'service-start',
    rule: {
      name: '服务停止后计划启动',
      description: '检测到服务停止或未运行时，记录启动服务计划动作；如明确开启受控自动执行，才会尝试真实启动。',
      enabled: true,
      autoExecute: false,
      executionMode: 'safe',
      priority: 'P1',
      logic: 'OR',
      conditions: [{ dataSource: '事件', metric: 'service_not_running', service: 'nginx.service', operator: '>=', threshold: 1, windowValue: 5, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' }],
      actions: [{ type: '启动服务', target: 'nginx.service', retries: 1, cooldown: 10 }],
      notification: defaultRule.notification,
    },
  },
  {
    label: '服务失败 → 重启服务（安全模式记录）',
    value: 'service-restart',
    rule: {
      name: '服务失败后计划重启',
      description: '检测到服务 failed/error/dead 事件时，记录重启服务计划动作；如明确开启受控自动执行，才会尝试真实重启。',
      enabled: true,
      autoExecute: false,
      executionMode: 'safe',
      priority: 'P1',
      logic: 'OR',
      conditions: [{ dataSource: '事件', metric: 'service_failed', service: 'nginx.service', operator: '>=', threshold: 1, windowValue: 5, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' }],
      actions: [{ type: '重启服务', target: 'nginx.service', retries: 1, cooldown: 10 }],
      notification: defaultRule.notification,
    },
  },
  {
    label: 'CPU 高水位 → 计划重启服务',
    value: 'cpu-restart',
    rule: defaultRule,
  },
]

export default function RuleFormDrawer({ open, editingRule, saving = false, onClose, onSubmit }) {
  const [form] = Form.useForm()
  const autoExecute = Form.useWatch('autoExecute', form)

  useEffect(() => {
    if (!open) return
    form.setFieldsValue({ ...defaultRule, ...(editingRule ?? {}) })
  }, [editingRule, form, open])

  const applyTemplate = (value) => {
    const template = templates.find((item) => item.value === value)
    if (template) form.setFieldsValue(template.rule)
  }

  const submitRule = (values) => {
    onSubmit({ ...values, executionMode: values.autoExecute ? 'controlled' : 'safe' })
  }

  return (
    <Drawer
      title={editingRule ? '编辑自愈规则' : '新建自愈规则'}
      open={open}
      onClose={onClose}
      size="large"
      destroyOnClose
      extra={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => form.submit()}>
            保存规则
          </Button>
        </Space>
      }
    >
      <Form form={form} layout="vertical" onFinish={submitRule} className="space-y-4">
        <Card className={autoExecute ? 'border-orange-500/30 bg-orange-500/10' : 'border-blue-500/30 bg-blue-500/10'}>
          <Space orientation="vertical" size={8}>
            <Typography.Text strong>{autoExecute ? '受控自动执行已开启' : '默认安全模式'}</Typography.Text>
            <Typography.Text type="secondary">
              规则会读取真实 CPU/内存/磁盘、日志和服务事件；安全模式只记录计划动作。开启受控自动执行后，仅“启动服务/重启服务”会使用已保存 Pull 凭据通过 SSH/WinRM 执行，脚本、扩缩容和任意命令仍不会执行。
            </Typography.Text>
          </Space>
        </Card>

        <Card title="常用模板" className="self-healing-form-card">
          <Space orientation="vertical" style={{ width: '100%' }}>
            <Typography.Text type="secondary">选择模板会自动填充条件和动作，默认仍为安全模式。服务名请按实际主机上报的服务名修改，例如 nginx.service、payment-api。</Typography.Text>
            <Select placeholder="选择一个自愈规则模板" options={templates.map(({ label, value }) => ({ label, value }))} onChange={applyTemplate} />
          </Space>
        </Card>

        <Card title="基本信息" className="self-healing-form-card">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}>
              <Input placeholder="例如：支付服务错误率自动重启" />
            </Form.Item>
            <Form.Item name="priority" label="优先级" rules={[{ required: true }]}>
              <Select options={['P0', 'P1', 'P2', 'P3'].map((value) => ({ label: value, value }))} />
            </Form.Item>
          </div>
          <Form.Item name="description" label="描述">
            <Input.TextArea rows={3} placeholder="描述该自愈规则的适用场景" />
          </Form.Item>
          <Form.Item name="enabled" valuePropName="checked">
            <Checkbox>创建后立即启用</Checkbox>
          </Form.Item>
        </Card>

        <Card title="执行控制 / 安全策略" className="self-healing-form-card">
          <Form.Item name="executionMode" hidden>
            <Input />
          </Form.Item>
          <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
            <div className="flex flex-col gap-3 rounded-lg border border-slate-700/70 bg-slate-950/30 p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <Typography.Text strong>启用受控自动执行</Typography.Text>
                <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                  关闭时只记录计划动作；开启后命中规则会尝试启动/重启单个明确匹配的服务。
                </Typography.Paragraph>
              </div>
              <Form.Item name="autoExecute" valuePropName="checked" noStyle>
                <Switch
                  checkedChildren="受控执行"
                  unCheckedChildren="安全模式"
                  onChange={(checked) => form.setFieldValue('executionMode', checked ? 'controlled' : 'safe')}
                />
              </Form.Item>
            </div>
            {autoExecute && (
              <Alert
                showIcon
                type="warning"
                message="请确认目标服务唯一且 Pull 凭据可用"
                description="受控执行会真实执行 systemctl start/restart 或 Start-Service/Restart 流程。服务名如果匹配多台主机或主机处于维护中，后端会拒绝执行并写入历史。"
              />
            )}
          </Space>
        </Card>

        <Card title="触发条件" className="self-healing-form-card">
          <Form.Item name="logic" label="复合条件关系">
            <Radio.Group options={['AND', 'OR'].map((value) => ({ label: value, value }))} optionType="button" />
          </Form.Item>
          <Form.List name="conditions">
            {(fields, { add, remove }) => (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <div key={field.key} className="rounded-lg border border-slate-700/70 bg-slate-950/30 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <Typography.Text strong>条件 #{field.name + 1}</Typography.Text>
                      {fields.length > 1 && <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                      <Form.Item name={[field.name, 'dataSource']} label="数据源类型" rules={[{ required: true }]}>
                        <Select options={['指标', '事件', '日志'].map((value) => ({ label: value, value }))} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'metric']} label="指标/日志/事件名称" rules={[{ required: true }]}>
                        <AutoComplete options={metricOptions} placeholder="cpu_usage、ERROR、event_count 等" />
                      </Form.Item>
                      <div>
                        <Form.Item name={[field.name, 'service']} label="对象" rules={[{ required: true }]}>
                          <AutoComplete options={serviceOptions} placeholder="指标填主机ID/hostname/IP或服务名；日志/事件填服务名" />
                        </Form.Item>
                        <Typography.Text type="secondary">指标填主机ID/hostname/IP或服务名；日志/事件填服务名。</Typography.Text>
                      </div>
                      <Form.Item name={[field.name, 'operator']} label="条件" rules={[{ required: true }]}>
                        <Select options={['>', '>=', '<', '<=', '=='].map((value) => ({ label: value, value }))} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'threshold']} label="阈值" rules={[{ required: true }]}>
                        <InputNumber style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item label="时间窗口">
                        <Space.Compact style={{ width: '100%' }}>
                          <Form.Item name={[field.name, 'windowValue']} noStyle rules={[{ required: true }]}><InputNumber style={{ width: '60%' }} /></Form.Item>
                          <Form.Item name={[field.name, 'windowUnit']} noStyle><Select style={{ width: '40%' }} options={['秒', '分钟'].map((value) => ({ label: value, value }))} /></Form.Item>
                        </Space.Compact>
                      </Form.Item>
                      <Form.Item label="评估间隔">
                        <Space.Compact style={{ width: '100%' }}>
                          <Form.Item name={[field.name, 'intervalValue']} noStyle rules={[{ required: true }]}><InputNumber style={{ width: '60%' }} /></Form.Item>
                          <Form.Item name={[field.name, 'intervalUnit']} noStyle><Select style={{ width: '40%' }} options={['秒', '分钟'].map((value) => ({ label: value, value }))} /></Form.Item>
                        </Space.Compact>
                      </Form.Item>
                    </div>
                  </div>
                ))}
                <Button block icon={<PlusOutlined />} onClick={() => add(defaultRule.conditions[0])}>添加复合条件</Button>
              </Space>
            )}
          </Form.List>
        </Card>

        <Card title="自愈动作" className="self-healing-form-card">
          <Form.List name="actions">
            {(fields, { add, remove }) => (
              <Space orientation="vertical" size="middle" style={{ width: '100%' }}>
                {fields.map((field) => (
                  <div key={field.key} className="rounded-lg border border-slate-700/70 bg-slate-950/30 p-4">
                    <div className="mb-3 flex items-center justify-between">
                      <Typography.Text strong>动作 #{field.name + 1}</Typography.Text>
                      {fields.length > 1 && <Button danger type="text" icon={<DeleteOutlined />} onClick={() => remove(field.name)} />}
                    </div>
                    <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                      <Form.Item name={[field.name, 'type']} label="动作类型" rules={[{ required: true }]}><Select options={['启动服务', '重启服务', '扩缩容', '执行脚本', '发通知'].map((value) => ({ label: value, value }))} /></Form.Item>
                      <Form.Item name={[field.name, 'target']} label="动作目标" rules={[{ required: true }]}><Input placeholder="服务名或服务记录 ID，例如 nginx.service" /></Form.Item>
                      <Form.Item name={[field.name, 'retries']} label="重试次数"><InputNumber min={0} max={2} style={{ width: '100%' }} /></Form.Item>
                      <Form.Item name={[field.name, 'cooldown']} label="冷却时间（分钟）"><InputNumber min={0} style={{ width: '100%' }} /></Form.Item>
                    </div>
                  </div>
                ))}
                <Button block icon={<PlusOutlined />} onClick={() => add(defaultRule.actions[0])}>添加动作</Button>
              </Space>
            )}
          </Form.List>
        </Card>

        <Card title="通知配置" className="self-healing-form-card">
          <Form.Item name={['notification', 'receivers']} label="负责人">
            <Input placeholder="例如：SRE 值班组、张三" />
          </Form.Item>
          <Form.Item name={['notification', 'template']} label="通知模板（支持变量）">
            <Input.TextArea rows={4} placeholder="可使用 {{ruleName}}、{{service}}、{{value}} 等变量" />
          </Form.Item>
        </Card>
      </Form>
    </Drawer>
  )
}
