import { DeleteOutlined, PlusOutlined } from '@ant-design/icons'
import { Button, Card, Form, Input, Popconfirm, Radio, Select, Space, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { getErrorMessage } from '../../api/http'
import { deleteLogCollectionRule, getLogCollectionRules, saveLogCollectionRule } from '../../api/logs'
import type { Host } from '../../types/host'
import type { LogCollectionRule } from '../../types/log'

interface RuleFormValues {
  scope: 'host' | 'group'
  hostId?: string
  hostGroup?: string
  pathsText: string
  enabled: boolean
}

export default function LogCollectionRulePanel({ hosts, groups }: { hosts: Host[]; groups: string[] }) {
  const [form] = Form.useForm<RuleFormValues>()
  const [rules, setRules] = useState<LogCollectionRule[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const scope = Form.useWatch('scope', form) ?? 'host'

  const hostOptions = useMemo(() => hosts.map((host) => ({ label: `${host.ip} / ${host.hostname}`, value: host.id })), [hosts])
  const groupOptions = useMemo(() => groups.map((group) => ({ label: group, value: group })), [groups])
  const hostNameById = useMemo(() => Object.fromEntries(hosts.map((host) => [host.id, `${host.ip} / ${host.hostname}`])), [hosts])

  async function load() {
    setLoading(true)
    try {
      setRules(await getLogCollectionRules())
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    form.setFieldsValue({ scope: 'host', enabled: true })
    void load()
  }, [form])

  async function submit(values: RuleFormValues) {
    setSaving(true)
    try {
      const paths = values.pathsText.split('\n').map((path) => path.trim()).filter(Boolean)
      await saveLogCollectionRule({ scope: values.scope, hostId: values.hostId, hostGroup: values.hostGroup, paths, enabled: values.enabled })
      message.success('日志采集配置已保存')
      form.resetFields()
      form.setFieldsValue({ scope: 'host', enabled: true })
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '日志采集配置保存失败'))
    } finally {
      setSaving(false)
    }
  }

  const columns: ColumnsType<LogCollectionRule> = [
    { title: '范围', dataIndex: 'scope', width: 100, render: (value) => <Tag color={value === 'host' ? 'blue' : 'purple'}>{value === 'host' ? '主机' : '主机组'}</Tag> },
    { title: '目标', render: (_, rule) => rule.scope === 'host' ? hostNameById[rule.hostId ?? ''] ?? rule.hostId : rule.hostGroup },
    { title: '日志路径', dataIndex: 'paths', render: (paths: string[]) => <Space direction="vertical" size={0}>{paths.map((path) => <Typography.Text code key={path}>{path}</Typography.Text>)}</Space> },
    { title: '状态', dataIndex: 'enabled', width: 100, render: (enabled) => <Tag color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '停用'}</Tag> },
    { title: '操作', width: 100, render: (_, rule) => <Popconfirm title="删除该采集配置？" onConfirm={async () => { await deleteLogCollectionRule(rule.id); message.success('已删除'); await load() }}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm> },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card title="日志采集配置" extra={<Typography.Text type="secondary">文件路径用于业务日志；Windows System/Application 事件日志由 Agent 默认采集，并映射为 ERROR/WARN/INFO/DEBUG。</Typography.Text>}>
        <Form form={form} layout="vertical" onFinish={submit}>
          <Space align="start" wrap>
            <Form.Item name="scope" label="配置范围" rules={[{ required: true }]}>
              <Radio.Group optionType="button" options={[{ label: '指定主机', value: 'host' }, { label: '指定主机组', value: 'group' }]} />
            </Form.Item>
            {scope === 'host' ? (
              <Form.Item name="hostId" label="主机" rules={[{ required: true, message: '请选择主机' }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择主机" style={{ width: 260 }} options={hostOptions} />
              </Form.Item>
            ) : (
              <Form.Item name="hostGroup" label="主机组" rules={[{ required: true, message: '请选择主机组' }]}>
                <Select showSearch optionFilterProp="label" placeholder="选择主机组" style={{ width: 220 }} options={groupOptions} />
              </Form.Item>
            )}
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
          <Form.Item name="pathsText" label="日志路径" rules={[{ required: true, message: '请输入日志路径' }]} extra="一行一个路径，支持日期模板：%Y=年、%m=月、%d=日。例如 Windows：D:\\logs 或 D:\\logs\\CalcFut_%Y%m%d.log；Linux：/opt/app/logs/CalcFut_%Y%m%d.log。Windows 系统/应用程序事件日志无需在这里配置路径。">
            <Input.TextArea rows={4} placeholder={'D:\\logs\\CalcFut_%Y%m%d.log\n/opt/app/logs/CalcFut_%Y%m%d.log'} />
          </Form.Item>
          <Button type="primary" htmlType="submit" icon={<PlusOutlined />} loading={saving}>保存配置</Button>
        </Form>
      </Card>
      <Card title={`已配置规则（${rules.length}）`}>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={rules} pagination={{ pageSize: 6 }} />
      </Card>
    </Space>
  )
}
