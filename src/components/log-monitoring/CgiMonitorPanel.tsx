import { ClockCircleOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Checkbox, Col, Descriptions, Drawer, Flex, Form, Input, InputNumber, Popconfirm, Radio, Row, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { createCgiMonitorRule, deleteCgiMonitorRule, evaluateCgiMonitorRule, listCgiMonitorAlerts, listCgiMonitorRules, updateCgiMonitorRule } from '../../api/cgiMonitors'
import { getErrorMessage } from '../../api/http'
import PermissionGate from '../auth/PermissionGate'
import { PERMISSIONS } from '../../config/permissions'
import type { CgiMonitorAlertRecord, CgiMonitorChannel, CgiMonitorRule, CgiMonitorRuleInput, CgiMonitorTimeRange } from '../../types/cgiMonitor'
import type { Host } from '../../types/host'
import { formatShanghaiTime } from '../../utils/time'
import SelfHealingBindingCard from './SelfHealingBindingCard'

const alertLevelColor: Record<string, string> = { 紧急: 'red', 严重: 'volcano', 警告: 'gold', 提示: 'blue' }
type RuleStatusFilter = 'all' | 'enabled' | 'disabled'
const dayOptions = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 },
]

interface RuleFormValues extends Omit<CgiMonitorRuleInput, 'holidays' | 'notification'> {
  holidaysText?: string
  notification?: {
    channels?: CgiMonitorChannel[]
    webhookUrl?: string
    receivers?: string
  }
}

function splitLines(value?: string) {
  return (value || '').split(/\n|,/).map((item) => item.trim()).filter(Boolean)
}

function normalizeTimeRanges(values?: CgiMonitorTimeRange[]) {
  return (values || []).filter((range) => range?.start && range?.end)
}

function toPayload(values: RuleFormValues): CgiMonitorRuleInput {
  const notification = values.notification?.channels?.length
    ? { channels: values.notification.channels, webhookUrl: values.notification.webhookUrl, receivers: values.notification.receivers }
    : undefined
  const binding = values.selfHealingBinding
  return {
    name: values.name,
    description: values.description,
    enabled: values.enabled,
    url: values.url,
    probeHostId: values.probeHostId || null,
    method: values.method,
    keyword: values.keyword,
    matchMode: values.matchMode,
    expectedStatus: values.expectedStatus || null,
    timeoutMs: values.timeoutMs,
    intervalSeconds: values.intervalSeconds,
    failureThreshold: values.failureThreshold,
    cooldownMinutes: values.cooldownMinutes,
    alertLevel: values.alertLevel,
    daysOfWeek: values.daysOfWeek,
    timeRanges: normalizeTimeRanges(values.timeRanges),
    holidayMode: values.holidayMode,
    holidays: splitLines(values.holidaysText),
    notification,
    selfHealingBinding: binding ? { ...binding, targetServiceName: binding.targetServiceName || binding.serviceName || '', serviceName: binding.targetServiceName || binding.serviceName || '', executionMode: binding.autoExecute ? 'controlled' : 'safe' } : undefined,
  }
}

function defaultSelfHealingBinding(cooldownMinutes = 30): NonNullable<CgiMonitorRuleInput['selfHealingBinding']> {
  return { enabled: false, actionType: '重启服务', targetServiceName: '', serviceName: '', autoExecute: false, executionMode: 'safe', retries: 0, cooldownMinutes }
}

function toFormValues(rule?: CgiMonitorRule): Partial<RuleFormValues> {
  if (!rule) {
    return {
      enabled: true,
      method: 'GET',
      matchMode: 'contains',
      expectedStatus: 200,
      timeoutMs: 8000,
      intervalSeconds: 60,
      failureThreshold: 1,
      cooldownMinutes: 30,
      alertLevel: '警告',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      timeRanges: [{ start: '00:00', end: '23:59' }],
      holidayMode: 'ignore',
      notification: { channels: ['站内告警'] },
      selfHealingBinding: defaultSelfHealingBinding(),
    }
  }
  return {
    ...rule,
    holidaysText: rule.holidays.join('\n'),
    notification: rule.notification,
    selfHealingBinding: rule.selfHealingBinding ?? defaultSelfHealingBinding(rule.cooldownMinutes),
  }
}

function matchModeText(rule: CgiMonitorRule) {
  return rule.matchMode === 'contains' ? `必须包含「${rule.keyword}」` : `不能包含「${rule.keyword}」`
}

function scheduleText(rule: CgiMonitorRule) {
  const days = rule.daysOfWeek.length ? rule.daysOfWeek.map((day) => dayOptions.find((item) => item.value === day)?.label).join('、') : '每天'
  const ranges = rule.timeRanges.length ? rule.timeRanges.map((range) => `${range.start}-${range.end}`).join('、') : '全天'
  const holiday = rule.holidayMode === 'include' ? '仅节假日' : rule.holidayMode === 'exclude' ? '排除节假日' : '不判断节假日'
  return `${days} · ${ranges} · ${holiday}`
}

function selfHealingTag(rule: CgiMonitorRule) {
  const binding = rule.selfHealingBinding
  if (!binding?.enabled) return <Tag color="default">未绑定自愈</Tag>
  if (binding.autoExecute && binding.executionMode === 'controlled') return <Tag color="orange">自愈受控执行</Tag>
  return <Tag color="blue">自愈安全模式</Tag>
}

export default function CgiMonitorPanel({ hosts }: { hosts: Host[] }) {
  const [rules, setRules] = useState<CgiMonitorRule[]>([])
  const [alerts, setAlerts] = useState<CgiMonitorAlertRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<CgiMonitorRule>()
  const [selectedRule, setSelectedRule] = useState<CgiMonitorRule>()
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')
  const [form] = Form.useForm<RuleFormValues>()
  const hostOptions = hosts.map((host) => ({
    label: `${host.ip} · ${host.hostname}`,
    value: host.id,
    disabled: !host.pullCredential?.enabled,
  }))

  const probeSourceText = (rule: CgiMonitorRule) => rule.probeHost ? `${rule.probeHost.ip} · ${rule.probeHost.hostname}` : '平台服务端'

  const load = async () => {
    setLoading(true)
    try {
      const [nextRules, nextAlerts] = await Promise.all([listCgiMonitorRules(), listCgiMonitorAlerts()])
      setRules(nextRules)
      setAlerts(nextAlerts)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const stats = useMemo(() => ({
    total: rules.length,
    enabled: rules.filter((rule) => rule.enabled).length,
    disabled: rules.filter((rule) => !rule.enabled).length,
    unhealthy: rules.filter((rule) => rule.consecutiveFailures > 0).length,
  }), [rules])

  const filteredRules = useMemo(() => rules.filter((rule) => {
    if (statusFilter === 'enabled') return rule.enabled
    if (statusFilter === 'disabled') return !rule.enabled
    return true
  }), [rules, statusFilter])

  const openCreate = () => {
    setEditingRule(undefined)
    form.setFieldsValue(toFormValues())
    setDrawerOpen(true)
  }

  const openEdit = (rule: CgiMonitorRule) => {
    setEditingRule(rule)
    form.setFieldsValue(toFormValues(rule))
    setDrawerOpen(true)
  }

  const submit = async (values: RuleFormValues) => {
    setSubmitting(true)
    try {
      const payload = toPayload(values)
      if (editingRule) await updateCgiMonitorRule(editingRule.id, payload)
      else await createCgiMonitorRule(payload)
      message.success(editingRule ? 'CGI/URL 监控规则已更新' : 'CGI/URL 监控规则已创建')
      setDrawerOpen(false)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '保存 CGI/URL 监控规则失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const runEvaluate = async (rule: CgiMonitorRule) => {
    try {
      const result = await evaluateCgiMonitorRule(rule.id)
      if (!result.checked) message.info(result.skippedReason || '本次未检测')
      else if (result.triggered) message.warning(`已触发告警：${result.errorMessage || '检测异常'}${result.notificationResults?.length ? `；通知：${result.notificationResults.join('；')}` : ''}`)
      else if (result.ok) message.success(`检测正常：状态码 ${result.statusCode ?? '-'}，耗时 ${result.latencyMs ?? '-'}ms`)
      else message.warning(`检测异常，连续失败 ${result.consecutiveFailures} 次：${result.errorMessage}`)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '手动检测失败'))
    }
  }

  const removeRule = async (rule: CgiMonitorRule) => {
    try {
      await deleteCgiMonitorRule(rule.id)
      message.success('CGI/URL 监控规则已删除')
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '删除 CGI/URL 监控规则失败'))
    }
  }

  const columns: ColumnsType<CgiMonitorRule> = [
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 90,
      render: (enabled: boolean) => <Tag className="monitor-rule-status-tag" color={enabled ? 'green' : 'default'}>{enabled ? '启用' : '停用'}</Tag>,
    },
    {
      title: '规则',
      dataIndex: 'name',
      render: (_, rule) => (
        <Space direction="vertical" size={2}>
          <Space wrap>
            <Typography.Text strong>{rule.name}</Typography.Text>
            <Tag color={alertLevelColor[rule.alertLevel]}>{rule.alertLevel}</Tag>
            {selfHealingTag(rule)}
          </Space>
          <Typography.Text type="secondary" copyable>{rule.url}</Typography.Text>
          <Typography.Text type="secondary">探测：{probeSourceText(rule)}</Typography.Text>
        </Space>
      ),
    },
    { title: '关键字规则', width: 220, render: (_, rule) => <Tag color={rule.matchMode === 'contains' ? 'blue' : 'orange'}>{matchModeText(rule)}</Tag> },
    { title: '检查策略', width: 190, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text>{rule.intervalSeconds}s / 连续 {rule.failureThreshold} 次</Typography.Text><Typography.Text type="secondary">期望状态：{rule.expectedStatus || '不限'}</Typography.Text></Space> },
    { title: '最近状态', width: 190, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text>{rule.lastStatusCode || '-'} · {rule.lastLatencyMs ?? '-'}ms</Typography.Text><Typography.Text type={rule.consecutiveFailures ? 'danger' : 'secondary'}>连续失败 {rule.consecutiveFailures} 次</Typography.Text></Space> },
    { title: '触发', width: 120, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text strong>{rule.triggerCount} 次</Typography.Text><Typography.Text type="secondary">{rule.lastTriggeredAt ? formatShanghaiTime(rule.lastTriggeredAt) : '未触发'}</Typography.Text></Space> },
    {
      title: '操作',
      width: 220,
      render: (_, rule) => (
        <Space wrap>
          <Button type="link" onClick={() => setSelectedRule(rule)}>详情</Button>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Button type="link" icon={<ExperimentOutlined />} onClick={() => runEvaluate(rule)}>检测</Button></PermissionGate>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(rule)}>编辑</Button></PermissionGate>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Popconfirm title="删除 CGI/URL 监控规则？" description="如已绑定异常自愈，自动生成的自愈规则和告警映射会被停用，历史记录保留。" onConfirm={() => removeRule(rule)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></PermissionGate>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><Card><Statistic title="URL规则总数" value={stats.total} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="启用规则" value={stats.enabled} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="停用规则" value={stats.disabled} valueStyle={{ color: stats.disabled ? '#8c8c8c' : undefined }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="当前异常" value={stats.unhealthy} valueStyle={{ color: stats.unhealthy ? '#ff4d4f' : undefined }} /></Card></Col>
      </Row>

      <Alert showIcon type="info" message="CGI/URL 内容监控" description="可由平台服务端或指定已纳管主机定时请求 URL，按响应内容关键字和状态码判断是否异常。例如选择 172.29.20.171 探测 http://192.168.1.1，设置“必须包含 400”，当响应未包含 400 时触发告警。" />

      <Card title="CGI/URL 监控规则" extra={<Space><Radio.Group size="small" optionType="button" buttonStyle="solid" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} options={[{ label: `全部 ${stats.total}`, value: 'all' }, { label: `启用 ${stats.enabled}`, value: 'enabled' }, { label: `停用 ${stats.disabled}`, value: 'disabled' }]} /><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button><PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建URL监控</Button></PermissionGate></Space>}>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={filteredRules} pagination={{ pageSize: 8 }} rowClassName={(rule) => rule.enabled ? '' : 'monitor-rule-disabled-row'} />
      </Card>

      <Card title="最近URL监控触发记录">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={alerts}
          pagination={{ pageSize: 6 }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 190, render: (value) => formatShanghaiTime(value) },
            { title: '规则', dataIndex: 'ruleId', render: (ruleId) => rules.find((rule) => rule.id === ruleId)?.name || ruleId },
            { title: '状态/耗时', width: 120, render: (_, record) => `${record.statusCode || '-'} / ${record.latencyMs ?? '-'}ms` },
            { title: '错误', dataIndex: 'errorMessage', render: (value) => value || '-' },
            { title: '通知结果', dataIndex: 'notificationResults', render: (values: string[]) => values?.length ? values.join('；') : '站内告警' },
            { title: '响应片段', dataIndex: 'responseSnippet', render: (value) => <Typography.Text ellipsis style={{ maxWidth: 360 }}>{value || '-'}</Typography.Text> },
          ]}
        />
      </Card>

      <Drawer title={editingRule ? '编辑 CGI/URL 监控' : '新建 CGI/URL 监控'} width={760} open={drawerOpen} onClose={() => setDrawerOpen(false)} extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" loading={submitting} onClick={() => form.submit()}>保存</Button></Space>} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submit} initialValues={toFormValues()}>
          <Row gutter={16}>
            <Col span={16}><Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input placeholder="例如：SS2 CGI 页面内容监控" /></Form.Item></Col>
            <Col span={8}><Form.Item name="enabled" label="启用状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} placeholder="说明该 URL 异常后的处理建议" /></Form.Item>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="method" label="请求方法"><Select options={['GET', 'POST', 'HEAD'].map((method) => ({ label: method, value: method }))} /></Form.Item></Col>
            <Col span={16}><Form.Item name="url" label="URL/CGI 地址" rules={[{ required: true, message: '请输入 URL' }]}><Input placeholder="http://ss2.icetech.com.cn" /></Form.Item></Col>
          </Row>
          <Form.Item name="probeHostId" label="探测主机" extra="选择主机后，将通过该主机已保存的 SSH/WinRM Pull 凭据发起 URL 检测；不选择则由平台服务端探测。">
            <Select allowClear showSearch optionFilterProp="label" options={hostOptions} placeholder="不选择则由平台服务端探测" />
          </Form.Item>
          <Row gutter={16}>
            <Col span={10}><Form.Item name="matchMode" label="关键字规则"><Select options={[{ label: '必须包含关键字，不包含则告警', value: 'contains' }, { label: '不能包含关键字，包含则告警', value: 'not_contains' }]} /></Form.Item></Col>
            <Col span={8}><Form.Item name="keyword" label="关键字" rules={[{ required: true, message: '请输入关键字' }]}><Input placeholder="400" /></Form.Item></Col>
            <Col span={6}><Form.Item name="expectedStatus" label="期望状态码"><InputNumber min={100} max={599} style={{ width: '100%' }} placeholder="200" /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={6}><Form.Item name="timeoutMs" label="超时时间"><InputNumber min={1000} max={60000} style={{ width: '100%' }} addonAfter="ms" /></Form.Item></Col>
            <Col span={6}><Form.Item name="intervalSeconds" label="检查间隔"><InputNumber min={10} max={86400} style={{ width: '100%' }} addonAfter="秒" /></Form.Item></Col>
            <Col span={6}><Form.Item name="failureThreshold" label="连续失败阈值"><InputNumber min={1} max={100} style={{ width: '100%' }} addonAfter="次" /></Form.Item></Col>
            <Col span={6}><Form.Item name="cooldownMinutes" label="冷却期"><InputNumber min={1} max={1440} style={{ width: '100%' }} addonAfter="分钟" /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="alertLevel" label="告警级别"><Select options={['紧急', '严重', '警告', '提示'].map((level) => ({ label: level, value: level }))} /></Form.Item></Col>
            <Col span={12}><Form.Item name="daysOfWeek" label="生效周期"><Checkbox.Group options={dayOptions} /></Form.Item></Col>
          </Row>
          <Card size="small" title={<Space><ClockCircleOutlined />时间段</Space>} style={{ marginBottom: 16 }}>
            <Form.List name="timeRanges">
              {(fields, { add, remove }) => (
                <Space direction="vertical" style={{ width: '100%' }}>
                  {fields.map((field) => (
                    <Flex key={field.key} gap="small" align="center">
                      <Form.Item {...field} name={[field.name, 'start']} style={{ flex: 1, marginBottom: 0 }}><Input placeholder="开始 HH:mm" /></Form.Item>
                      <span>至</span>
                      <Form.Item {...field} name={[field.name, 'end']} style={{ flex: 1, marginBottom: 0 }}><Input placeholder="结束 HH:mm" /></Form.Item>
                      <Button danger onClick={() => remove(field.name)}>删除</Button>
                    </Flex>
                  ))}
                  <Button onClick={() => add({ start: '09:00', end: '18:00' })}>添加时间段</Button>
                </Space>
              )}
            </Form.List>
          </Card>
          <Row gutter={16}>
            <Col span={10}><Form.Item name="holidayMode" label="节假日策略"><Select options={[{ label: '不判断节假日', value: 'ignore' }, { label: '仅节假日生效', value: 'include' }, { label: '排除节假日', value: 'exclude' }]} /></Form.Item></Col>
            <Col span={14}><Form.Item name="holidaysText" label="节假日日期"><Input.TextArea rows={3} placeholder={'2026-10-01\n2026-10-02'} /></Form.Item></Col>
          </Row>
          <SelfHealingBindingCard
            form={form}
            hosts={hosts}
            description="开启后系统自动维护自愈规则和告警自动处理映射，URL 异常告警会触发对应动作。"
            safeDescription="URL 异常后会自动写入自愈执行历史和计划动作，不会执行远程命令。"
          />

          <Card size="small" title="通知配置">
            <Form.Item name={['notification', 'channels']} label="通知渠道" rules={[{ required: true, message: '请选择通知渠道' }]}><Checkbox.Group options={['站内告警', '企业微信', '钉钉']} /></Form.Item>
            <Form.Item name={['notification', 'webhookUrl']} label="企业微信/钉钉 Webhook" extra="可选覆盖；不填则使用设置页里的全局告警通知配置。"><Input placeholder="可选：填写后优先使用该规则自己的机器人 Webhook" /></Form.Item>
            <Form.Item name={['notification', 'receivers']} label="负责人/接收人"><Input placeholder="例如：SRE 值班群、张三" /></Form.Item>
          </Card>
        </Form>
      </Drawer>

      <DescriptionsModal rule={selectedRule} onClose={() => setSelectedRule(undefined)} />
    </Space>
  )
}

function DescriptionsModal({ rule, onClose }: { rule?: CgiMonitorRule; onClose: () => void }) {
  return (
    <DescriptionsModalInner rule={rule} onClose={onClose} />
  )
}

function DescriptionsModalInner({ rule, onClose }: { rule?: CgiMonitorRule; onClose: () => void }) {
  return (
    <Drawer title="CGI/URL 监控详情" width={680} open={Boolean(rule)} onClose={onClose} destroyOnHidden>
      {rule && (
        <Descriptions bordered column={1} size="small">
          <Descriptions.Item label="规则名称">{rule.name}</Descriptions.Item>
          <Descriptions.Item label="URL"><Typography.Text copyable>{rule.url}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="探测来源">{rule.probeHost ? `${rule.probeHost.ip} · ${rule.probeHost.hostname}` : '平台服务端'}</Descriptions.Item>
          <Descriptions.Item label="关键字规则">{matchModeText(rule)}</Descriptions.Item>
          <Descriptions.Item label="检查策略">每 {rule.intervalSeconds} 秒检查，连续失败 {rule.failureThreshold} 次触发</Descriptions.Item>
          <Descriptions.Item label="周期">{scheduleText(rule)}</Descriptions.Item>
          <Descriptions.Item label="异常自愈">
            {rule.selfHealingBinding?.enabled ? (
              <Space direction="vertical" size={4}>
                <Space>{selfHealingTag(rule)}<Typography.Text>{rule.selfHealingBinding.actionType} → {rule.selfHealingBinding.targetServiceName || rule.selfHealingBinding.serviceName}</Typography.Text></Space>
                <Typography.Text type="secondary">目标主机：{rule.selfHealingBinding.targetHostId || '未指定'}；冷却 {rule.selfHealingBinding.cooldownMinutes} 分钟，重试 {rule.selfHealingBinding.retries} 次</Typography.Text>
                {rule.generatedSelfHealingRuleId && <Typography.Text type="secondary">自愈规则：{rule.generatedSelfHealingRuleId}</Typography.Text>}
                {rule.generatedAlertHandlingRuleId && <Typography.Text type="secondary">告警映射：{rule.generatedAlertHandlingRuleId}</Typography.Text>}
              </Space>
            ) : '未绑定'}
          </Descriptions.Item>
          <Descriptions.Item label="最近状态">{rule.lastStatusCode || '-'} / {rule.lastLatencyMs ?? '-'}ms / {rule.lastError || '正常'}</Descriptions.Item>
        </Descriptions>
      )}
    </Drawer>
  )
}
