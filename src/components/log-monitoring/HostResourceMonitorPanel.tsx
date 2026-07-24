import { BellOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, Button, Card, Checkbox, Col, Descriptions, Drawer, Flex, Form, Input, InputNumber, Popconfirm, Radio, Row, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { createHostResourceMonitorRule, deleteHostResourceMonitorRule, evaluateHostResourceMonitorRule, listHostResourceMonitorAlerts, listHostResourceMonitorRules, updateHostResourceMonitorRule } from '../../api/hostResourceMonitors'
import { getErrorMessage } from '../../api/http'
import { PERMISSIONS } from '../../config/permissions'
import type { Host } from '../../types/host'
import type { HostResourceMetric, HostResourceMonitorAlertRecord, HostResourceMonitorRule, HostResourceMonitorRuleInput } from '../../types/hostResourceMonitor'
import type { LogMonitorChannel, LogMonitorTimeRange } from '../../types/log'
import PermissionGate from '../auth/PermissionGate'

const alertLevelColor: Record<string, string> = { 紧急: 'red', 严重: 'volcano', 警告: 'gold', 提示: 'blue' }
const metricLabel: Record<HostResourceMetric, string> = { cpu: 'CPU', memory: '内存', disk: '磁盘' }
const metricColor: Record<HostResourceMetric, string> = { cpu: 'blue', memory: 'green', disk: 'gold' }
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

interface RuleFormValues extends Omit<HostResourceMonitorRuleInput, 'holidays' | 'notification'> {
  holidaysText?: string
  notification?: {
    channels?: LogMonitorChannel[]
    webhookUrl?: string
    receivers?: string
  }
}

function splitLines(value?: string) {
  return (value || '').split(/\n|,/).map((item) => item.trim()).filter(Boolean)
}

function normalizeTimeRanges(values?: LogMonitorTimeRange[]) {
  return (values || []).filter((range) => range?.start && range?.end)
}

function formatDate(value?: string) {
  return value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '-'
}

function toPayload(values: RuleFormValues): HostResourceMonitorRuleInput {
  const notification = values.notification?.channels?.length
    ? { channels: values.notification.channels, webhookUrl: values.notification.webhookUrl, receivers: values.notification.receivers }
    : undefined
  const hostScope = values.hostScope ?? (values.hostId ? 'single' : 'all')
  const hostIds = Array.from(new Set((values.hostIds ?? []).filter(Boolean)))
  const hostTarget = hostScope === 'single'
    ? { hostScope, hostId: values.hostId, hostIds: values.hostId ? [values.hostId] : [], hostGroup: undefined }
    : hostScope === 'multiple'
      ? { hostScope, hostId: undefined, hostIds, hostGroup: undefined }
      : hostScope === 'group'
        ? { hostScope, hostId: undefined, hostIds: [], hostGroup: values.hostGroup }
        : { hostScope: 'all' as const, hostId: undefined, hostIds: [], hostGroup: undefined }

  return {
    name: values.name,
    description: values.description,
    enabled: values.enabled,
    ...hostTarget,
    metrics: values.metrics,
    threshold: values.threshold,
    cooldownMinutes: values.cooldownMinutes,
    alertLevel: values.alertLevel,
    daysOfWeek: values.daysOfWeek,
    timeRanges: normalizeTimeRanges(values.timeRanges),
    holidayMode: values.holidayMode,
    holidays: splitLines(values.holidaysText),
    notification,
  }
}

function toFormValues(rule?: HostResourceMonitorRule): Partial<RuleFormValues> {
  if (!rule) {
    return {
      enabled: true,
      hostScope: 'all',
      hostIds: [],
      metrics: ['cpu', 'memory', 'disk'],
      threshold: 80,
      cooldownMinutes: 30,
      alertLevel: '警告',
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      timeRanges: [{ start: '00:00', end: '23:59' }],
      holidayMode: 'ignore',
      notification: { channels: ['站内告警'] },
    }
  }
  const hostScope = rule.hostScope ?? (rule.hostId ? 'single' : 'all')
  return {
    ...rule,
    hostScope,
    hostId: rule.hostId || (hostScope === 'single' ? rule.hostIds[0] : undefined),
    hostIds: hostScope === 'multiple' ? rule.hostIds : rule.hostId ? [rule.hostId] : rule.hostIds,
    holidaysText: rule.holidays.join('\n'),
    notification: rule.notification,
  }
}

function scheduleText(rule: HostResourceMonitorRule) {
  const days = rule.daysOfWeek.length ? rule.daysOfWeek.map((day) => dayOptions.find((item) => item.value === day)?.label).join('、') : '每天'
  const ranges = rule.timeRanges.length ? rule.timeRanges.map((range) => `${range.start}-${range.end}`).join('、') : '全天'
  const holiday = rule.holidayMode === 'include' ? '仅节假日' : rule.holidayMode === 'exclude' ? '排除节假日' : '不判断节假日'
  return `${days} · ${ranges} · ${holiday}`
}

export default function HostResourceMonitorPanel({ hosts }: { hosts: Host[] }) {
  const [rules, setRules] = useState<HostResourceMonitorRule[]>([])
  const [alerts, setAlerts] = useState<HostResourceMonitorAlertRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<HostResourceMonitorRule>()
  const [selectedRule, setSelectedRule] = useState<HostResourceMonitorRule>()
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')
  const [form] = Form.useForm<RuleFormValues>()
  const hostScope = Form.useWatch('hostScope', form) ?? 'all'

  const hostOptions = useMemo(() => hosts.map((host) => ({ label: `${host.ip} · ${host.hostname}`, value: host.id })), [hosts])
  const groupOptions = useMemo(() => Array.from(new Set(hosts.map((host) => host.group).filter(Boolean))).map((group) => ({ label: group, value: group })), [hosts])
  const hostLabelById = useMemo(() => Object.fromEntries(hosts.map((host) => [host.id, `${host.ip} · ${host.hostname}`])), [hosts])

  const load = async () => {
    setLoading(true)
    try {
      const [nextRules, nextAlerts] = await Promise.all([listHostResourceMonitorRules(), listHostResourceMonitorAlerts()])
      setRules(nextRules)
      setAlerts(nextAlerts)
    } catch (error) {
      message.error(getErrorMessage(error, '加载主机资源监控失败'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [])

  const stats = useMemo(() => ({
    total: rules.length,
    enabled: rules.filter((rule) => rule.enabled).length,
    disabled: rules.filter((rule) => !rule.enabled).length,
    triggered: alerts.length,
  }), [alerts.length, rules])

  const filteredRules = useMemo(() => rules.filter((rule) => {
    if (statusFilter === 'enabled') return rule.enabled
    if (statusFilter === 'disabled') return !rule.enabled
    return true
  }), [rules, statusFilter])

  const formatRuleHostScope = (rule: HostResourceMonitorRule, detail = false) => {
    const scope = rule.hostScope ?? (rule.hostId ? 'single' : 'all')
    if (scope === 'single') {
      const hostId = rule.hostId || rule.hostIds[0]
      return hostId ? hostLabelById[hostId] || hostId : '未选择主机'
    }
    if (scope === 'multiple') {
      const hostIds = rule.hostIds || []
      if (detail) return hostIds.length ? hostIds.map((hostId) => hostLabelById[hostId] || hostId).join('、') : '未选择主机'
      return hostIds.length ? `多主机 ${hostIds.length} 台` : '未选择主机'
    }
    if (scope === 'group') return rule.hostGroup ? `主机组：${rule.hostGroup}` : '未选择主机组'
    return '全部主机'
  }

  const openCreate = () => {
    setEditingRule(undefined)
    form.setFieldsValue(toFormValues())
    setDrawerOpen(true)
  }

  const openEdit = (rule: HostResourceMonitorRule) => {
    setEditingRule(rule)
    form.setFieldsValue(toFormValues(rule))
    setDrawerOpen(true)
  }

  const submit = async (values: RuleFormValues) => {
    setSubmitting(true)
    try {
      const payload = toPayload(values)
      if (editingRule) await updateHostResourceMonitorRule(editingRule.id, payload)
      else await createHostResourceMonitorRule(payload)
      message.success(editingRule ? '主机资源监控规则已更新' : '主机资源监控规则已创建')
      setDrawerOpen(false)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '保存主机资源监控规则失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const runEvaluate = async (rule: HostResourceMonitorRule) => {
    try {
      const result = await evaluateHostResourceMonitorRule(rule.id)
      if (result.skippedReason) message.info(result.skippedReason)
      else if (result.triggered > 0) message.warning(`已触发 ${result.triggered} 个资源告警，评估 ${result.evaluated} 台主机`)
      else message.success(`评估完成：${result.evaluated} 台主机未达到阈值`)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '手动评估失败'))
    }
  }

  const removeRule = async (rule: HostResourceMonitorRule) => {
    try {
      await deleteHostResourceMonitorRule(rule.id)
      message.success('主机资源监控规则已删除')
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '删除主机资源监控规则失败'))
    }
  }

  const columns: ColumnsType<HostResourceMonitorRule> = [
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
          </Space>
          <Typography.Text type="secondary">{rule.description || '按 CPU、内存、磁盘使用率阈值触发告警'}</Typography.Text>
        </Space>
      ),
    },
    { title: '主机范围', width: 180, render: (_, rule) => <Typography.Text>{formatRuleHostScope(rule)}</Typography.Text> },
    { title: '指标', dataIndex: 'metrics', width: 170, render: (metrics: HostResourceMetric[]) => <Space wrap>{metrics.map((metric) => <Tag key={metric} color={metricColor[metric]}>{metricLabel[metric]}</Tag>)}</Space> },
    { title: '阈值', width: 150, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text>使用率 ≥ <Typography.Text strong>{rule.threshold}%</Typography.Text></Typography.Text><Typography.Text type="secondary">冷却 {rule.cooldownMinutes} 分钟</Typography.Text></Space> },
    { title: '周期', width: 260, render: (_, rule) => <Typography.Text type="secondary">{scheduleText(rule)}</Typography.Text> },
    { title: '通知', width: 170, render: (_, rule) => <Space wrap>{rule.notification.channels.map((channel) => <Tag key={channel} color={channel === '站内告警' ? 'blue' : 'purple'}>{channel}</Tag>)}</Space> },
    { title: '触发', width: 130, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text strong>{rule.triggerCount} 次</Typography.Text><Typography.Text type="secondary">{rule.lastTriggeredAt ? formatDate(rule.lastTriggeredAt) : '未触发'}</Typography.Text></Space> },
    {
      title: '操作',
      width: 220,
      render: (_, rule) => (
        <Space wrap>
          <Button type="link" onClick={() => setSelectedRule(rule)}>详情</Button>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Button type="link" icon={<ExperimentOutlined />} onClick={() => runEvaluate(rule)}>评估</Button></PermissionGate>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(rule)}>编辑</Button></PermissionGate>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Popconfirm title="删除主机资源监控规则？" description="删除后不会影响已产生的告警记录。" onConfirm={() => removeRule(rule)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></PermissionGate>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><Card><Statistic title="资源规则总数" value={stats.total} prefix={<BellOutlined />} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="启用规则" value={stats.enabled} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="停用规则" value={stats.disabled} valueStyle={{ color: stats.disabled ? '#8c8c8c' : undefined }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="触发记录" value={stats.triggered} valueStyle={{ color: stats.triggered ? '#faad14' : undefined }} /></Card></Col>
      </Row>

      <Alert showIcon type="info" message="主机资源阈值监控" description="对已纳管主机的 CPU、内存、磁盘使用率设置阈值；任一选中指标达到阈值时触发告警，命中冷却期时不会重复刷屏。" />

      <Card title="主机资源监控规则" extra={<Space><Radio.Group size="small" optionType="button" buttonStyle="solid" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} options={[{ label: `全部 ${stats.total}`, value: 'all' }, { label: `启用 ${stats.enabled}`, value: 'enabled' }, { label: `停用 ${stats.disabled}`, value: 'disabled' }]} /><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button><PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建资源监控</Button></PermissionGate></Space>}>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={filteredRules} pagination={{ pageSize: 8 }} rowClassName={(rule) => rule.enabled ? '' : 'monitor-rule-disabled-row'} />
      </Card>

      <Card title="最近资源监控触发记录">
        <Table
          rowKey="id"
          loading={loading}
          dataSource={alerts}
          pagination={{ pageSize: 6 }}
          columns={[
            { title: '时间', dataIndex: 'createdAt', width: 190, render: (value: string) => formatDate(value) },
            { title: '采样时间', dataIndex: 'sampledAt', width: 190, render: (value: string) => formatDate(value) },
            { title: '规则', dataIndex: 'ruleId', render: (ruleId: string) => rules.find((rule) => rule.id === ruleId)?.name || ruleId },
            { title: '主机', dataIndex: 'hostId', render: (hostId: string) => hostLabelById[hostId] || hostId },
            { title: '指标', dataIndex: 'metric', width: 100, render: (metric: HostResourceMetric) => <Tag color={metricColor[metric]}>{metricLabel[metric]}</Tag> },
            { title: '当前值', dataIndex: 'value', width: 110, render: (value: number) => <Typography.Text strong>{value}%</Typography.Text> },
            { title: '阈值', dataIndex: 'threshold', width: 100, render: (value: number) => `${value}%` },
            { title: '告警ID', dataIndex: 'alertId', render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
            { title: '通知结果', dataIndex: 'notificationResults', render: (values: string[]) => values?.length ? values.join('；') : '站内告警' },
          ]}
        />
      </Card>

      <Drawer title={editingRule ? '编辑主机资源监控' : '新建主机资源监控'} width={760} open={drawerOpen} onClose={() => setDrawerOpen(false)} extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" loading={submitting} onClick={() => form.submit()}>保存</Button></Space>} destroyOnHidden>
        <Form form={form} layout="vertical" onFinish={submit} initialValues={toFormValues()}>
          <Row gutter={16}>
            <Col span={16}><Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input placeholder="例如：生产主机资源水位过高" /></Form.Item></Col>
            <Col span={8}><Form.Item name="enabled" label="启用状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} placeholder="说明该规则关注的主机范围、处理建议或升级路径" /></Form.Item>
          <Form.Item name="hostScope" label="主机范围" rules={[{ required: true, message: '请选择主机范围' }]}>
            <Radio.Group optionType="button" options={[{ label: '全部主机', value: 'all' }, { label: '单台主机', value: 'single' }, { label: '多台主机', value: 'multiple' }, { label: '主机组', value: 'group' }]} />
          </Form.Item>
          {hostScope === 'single' && (
            <Form.Item name="hostId" label="主机" rules={[{ required: true, message: '请选择主机' }]}><Select showSearch optionFilterProp="label" options={hostOptions} placeholder="选择主机" /></Form.Item>
          )}
          {hostScope === 'multiple' && (
            <Form.Item name="hostIds" label="多台主机" rules={[{ required: true, message: '请选择至少一台主机' }]}><Select mode="multiple" showSearch optionFilterProp="label" options={hostOptions} placeholder="选择多台主机" /></Form.Item>
          )}
          {hostScope === 'group' && (
            <Form.Item name="hostGroup" label="主机组" rules={[{ required: true, message: '请选择主机组' }]}><Select showSearch optionFilterProp="label" options={groupOptions} placeholder="选择主机组" /></Form.Item>
          )}
          <Row gutter={16}>
            <Col span={12}>
              <Form.Item name="metrics" label="监控指标" rules={[{ required: true, message: '请选择监控指标' }, { validator: (_, value) => value?.length ? Promise.resolve() : Promise.reject(new Error('请选择至少一个监控指标')) }]}>
                <Checkbox.Group options={[{ label: 'CPU', value: 'cpu' }, { label: '内存', value: 'memory' }, { label: '磁盘', value: 'disk' }]} />
              </Form.Item>
            </Col>
            <Col span={12}><Form.Item name="alertLevel" label="告警级别"><Select options={['紧急', '严重', '警告', '提示'].map((level) => ({ label: level, value: level }))} /></Form.Item></Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="threshold" label="使用率阈值" rules={[{ required: true, message: '请输入阈值' }]}><InputNumber min={1} max={100} style={{ width: '100%' }} addonAfter="%" /></Form.Item></Col>
            <Col span={12}><Form.Item name="cooldownMinutes" label="冷却期"><InputNumber min={1} max={1440} style={{ width: '100%' }} addonAfter="分钟" /></Form.Item></Col>
          </Row>
          <Form.Item name="daysOfWeek" label="生效周期"><Checkbox.Group options={dayOptions} /></Form.Item>
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
          <Card size="small" title="通知配置">
            <Form.Item name={['notification', 'channels']} label="通知渠道" rules={[{ required: true, message: '请选择通知渠道' }]}><Checkbox.Group options={['站内告警', '企业微信', '钉钉']} /></Form.Item>
            <Form.Item name={['notification', 'webhookUrl']} label="企业微信/钉钉 Webhook" extra="可选覆盖；不填则使用设置页里的全局告警通知配置。"><Input placeholder="可选：填写后优先使用该规则自己的机器人 Webhook" /></Form.Item>
            <Form.Item name={['notification', 'receivers']} label="负责人/接收人"><Input placeholder="例如：基础设施 SRE 值班群、张三" /></Form.Item>
          </Card>
        </Form>
      </Drawer>

      <Drawer title="主机资源监控详情" width={680} open={Boolean(selectedRule)} onClose={() => setSelectedRule(undefined)} destroyOnHidden>
        {selectedRule && (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="规则名称">{selectedRule.name}</Descriptions.Item>
            <Descriptions.Item label="启用状态"><Tag color={selectedRule.enabled ? 'green' : 'default'}>{selectedRule.enabled ? '启用' : '停用'}</Tag></Descriptions.Item>
            <Descriptions.Item label="说明">{selectedRule.description || '-'}</Descriptions.Item>
            <Descriptions.Item label="主机范围">{formatRuleHostScope(selectedRule, true)}</Descriptions.Item>
            <Descriptions.Item label="监控指标"><Space wrap>{selectedRule.metrics.map((metric) => <Tag key={metric} color={metricColor[metric]}>{metricLabel[metric]}</Tag>)}</Space></Descriptions.Item>
            <Descriptions.Item label="触发条件">任一选中指标使用率 ≥ {selectedRule.threshold}%</Descriptions.Item>
            <Descriptions.Item label="冷却期">{selectedRule.cooldownMinutes} 分钟</Descriptions.Item>
            <Descriptions.Item label="周期">{scheduleText(selectedRule)}</Descriptions.Item>
            <Descriptions.Item label="通知">{selectedRule.notification.channels.join('、')}；{selectedRule.notification.receivers || '未指定接收人'}</Descriptions.Item>
            <Descriptions.Item label="最近评估">{formatDate(selectedRule.lastEvaluatedAt)}</Descriptions.Item>
            <Descriptions.Item label="最近触发">{selectedRule.lastTriggeredAt ? formatDate(selectedRule.lastTriggeredAt) : '未触发'}；累计 {selectedRule.triggerCount} 次</Descriptions.Item>
          </Descriptions>
        )}
      </Drawer>
    </Space>
  )
}
