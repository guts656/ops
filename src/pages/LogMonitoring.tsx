import { BellOutlined, ClockCircleOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Alert, AutoComplete, Button, Card, Checkbox, Col, Descriptions, Drawer, Flex, Form, Input, InputNumber, Modal, Popconfirm, Radio, Row, Select, Space, Statistic, Switch, Table, Tabs, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useEffect, useMemo, useState } from 'react'
import { createLogMonitorRule, deleteLogMonitorRule, evaluateLogMonitorRule, getLogServices, listLogMonitorAlerts, listLogMonitorRules, updateLogMonitorRule } from '../api/logs'
import { queryHosts } from '../api/hosts'
import CgiMonitorPanel from '../components/log-monitoring/CgiMonitorPanel'
import HostResourceMonitorPanel from '../components/log-monitoring/HostResourceMonitorPanel'
import SelfHealingBindingCard from '../components/log-monitoring/SelfHealingBindingCard'
import { getErrorMessage } from '../api/http'
import PermissionGate from '../components/auth/PermissionGate'
import { PERMISSIONS } from '../config/permissions'
import type { Host } from '../types/host'
import type { LogMonitorAlertRecord, LogMonitorChannel, LogMonitorRule, LogMonitorRuleInput, LogMonitorTimeRange } from '../types/log'

const levelColor: Record<string, string> = { ERROR: 'red', WARN: 'gold', INFO: 'blue', DEBUG: 'default' }
const alertLevelColor: Record<string, string> = { 紧急: 'red', 严重: 'volcano', 警告: 'gold', 提示: 'blue' }
const dayOptions = [
  { label: '周一', value: 1 },
  { label: '周二', value: 2 },
  { label: '周三', value: 3 },
  { label: '周四', value: 4 },
  { label: '周五', value: 5 },
  { label: '周六', value: 6 },
  { label: '周日', value: 7 },
]
const sourceOptions = [
  { label: 'Windows Application', value: 'eventlog:Application' },
  { label: 'Windows System', value: 'eventlog:System' },
  { label: 'Docker 容器', value: 'docker' },
  { label: '任意文件日志', value: 'file' },
]
type RuleStatusFilter = 'all' | 'enabled' | 'disabled'

interface RuleFormValues extends Omit<LogMonitorRuleInput, 'keywords' | 'holidays' | 'notification'> {
  keywordsText: string
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

function withoutNulls<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null)) as T
}

function toPayload(values: RuleFormValues): LogMonitorRuleInput {
  const notification = values.notification?.channels?.length
    ? {
        channels: values.notification.channels,
        webhookUrl: values.notification.webhookUrl,
        receivers: values.notification.receivers,
      }
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

  return withoutNulls({
    name: values.name,
    description: values.description,
    enabled: values.enabled,
    service: values.service,
    level: values.level,
    ...hostTarget,
    source: values.source,
    keywords: splitLines(values.keywordsText),
    threshold: values.threshold,
    windowMinutes: values.windowMinutes,
    cooldownMinutes: values.cooldownMinutes,
    alertLevel: values.alertLevel,
    daysOfWeek: values.daysOfWeek,
    timeRanges: normalizeTimeRanges(values.timeRanges),
    holidayMode: values.holidayMode,
    holidays: splitLines(values.holidaysText),
    notification,
    selfHealingBinding: values.selfHealingBinding ? { ...values.selfHealingBinding, targetServiceName: values.selfHealingBinding.targetServiceName || values.selfHealingBinding.serviceName || '', serviceName: values.selfHealingBinding.targetServiceName || values.selfHealingBinding.serviceName || '', executionMode: values.selfHealingBinding.autoExecute ? 'controlled' as const : 'safe' as const } : undefined,
  })
}

function toFormValues(rule?: LogMonitorRule): Partial<RuleFormValues> {
  if (!rule) {
    return {
      enabled: true,
      keywordsText: '',
      threshold: 10,
      windowMinutes: 5,
      cooldownMinutes: 30,
      alertLevel: '警告',
      daysOfWeek: [1, 2, 3, 4, 5],
      timeRanges: [{ start: '00:00', end: '23:59' }],
      holidayMode: 'ignore',
      notification: { channels: ['站内告警'] },
      selfHealingBinding: { enabled: false, actionType: '重启服务', targetServiceName: '', serviceName: '', autoExecute: false, executionMode: 'safe', retries: 0, cooldownMinutes: 30 },
      hostScope: 'all',
      hostIds: [],
    }
  }
  const hostScope = rule.hostScope ?? (rule.hostId ? 'single' : 'all')
  return {
    ...rule,
    hostScope,
    hostId: rule.hostId || (hostScope === 'single' ? rule.hostIds[0] : undefined),
    hostIds: hostScope === 'multiple' ? rule.hostIds : rule.hostId ? [rule.hostId] : rule.hostIds,
    keywordsText: rule.keywords.join('\n'),
    holidaysText: rule.holidays.join('\n'),
    notification: rule.notification,
  }
}

function scheduleText(rule: LogMonitorRule) {
  const days = rule.daysOfWeek.length ? rule.daysOfWeek.map((day) => dayOptions.find((item) => item.value === day)?.label).join('、') : '每天'
  const ranges = rule.timeRanges.length ? rule.timeRanges.map((range) => `${range.start}-${range.end}`).join('、') : '全天'
  const holiday = rule.holidayMode === 'include' ? '仅节假日' : rule.holidayMode === 'exclude' ? '排除节假日' : '不判断节假日'
  return `${days} · ${ranges} · ${holiday}`
}

function selfHealingTag(rule: LogMonitorRule) {
  const binding = rule.selfHealingBinding
  if (!binding?.enabled) return <Tag color="default">未绑定自愈</Tag>
  if (binding.autoExecute && binding.executionMode === 'controlled') return <Tag color="orange">自愈受控执行</Tag>
  return <Tag color="blue">自愈安全模式</Tag>
}

export default function LogMonitoring() {
  const [rules, setRules] = useState<LogMonitorRule[]>([])
  const [alerts, setAlerts] = useState<LogMonitorAlertRecord[]>([])
  const [hosts, setHosts] = useState<Host[]>([])
  const [services, setServices] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<LogMonitorRule>()
  const [selectedRule, setSelectedRule] = useState<LogMonitorRule>()
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')
  const [form] = Form.useForm<RuleFormValues>()
  const hostScope = Form.useWatch('hostScope', form) ?? 'all'

  const load = async () => {
    setLoading(true)
    try {
      const [nextRules, nextAlerts, nextHosts, nextServices] = await Promise.all([listLogMonitorRules(), listLogMonitorAlerts(), queryHosts({}), getLogServices()])
      setRules(nextRules)
      setAlerts(nextAlerts)
      setHosts(nextHosts)
      setServices(nextServices)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

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

  const hostOptions = hosts.map((host) => ({ label: `${host.ip} · ${host.hostname}`, value: host.id }))
  const groupOptions = Array.from(new Set(hosts.map((host) => host.group).filter(Boolean))).map((group) => ({ label: group, value: group }))
  const hostLabelById = Object.fromEntries(hosts.map((host) => [host.id, `${host.ip} · ${host.hostname}`]))
  const serviceOptions = services.map((service) => ({ label: service.startsWith('container:') ? `容器：${service.replace('container:', '')}` : service, value: service }))

  const formatRuleHostScope = (rule: LogMonitorRule, detail = false) => {
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

  const renderMatchConditions = (rule: LogMonitorRule) => {
    const conditions = [
      ...rule.keywords.slice(0, 4).map((keyword) => ({ key: `keyword-${keyword}`, label: keyword, color: undefined as string | undefined })),
      ...(rule.keywords.length > 4 ? [{ key: 'keyword-more', label: `+${rule.keywords.length - 4}`, color: undefined as string | undefined }] : []),
      ...(rule.level ? [{ key: 'level', label: `级别：${rule.level}`, color: levelColor[rule.level] }] : []),
      ...(rule.service ? [{ key: 'service', label: `服务：${rule.service}`, color: 'blue' }] : []),
      ...(rule.source ? [{ key: 'source', label: `来源：${rule.source}`, color: 'purple' }] : []),
      ...((rule.hostScope ?? 'all') !== 'all' ? [{ key: 'host-scope', label: formatRuleHostScope(rule), color: 'cyan' }] : []),
    ]
    return <Space wrap>{conditions.length ? conditions.map((condition) => <Tag key={condition.key} color={condition.color}>{condition.label}</Tag>) : <Typography.Text type="secondary">全部日志</Typography.Text>}</Space>
  }

  const openCreate = () => {
    setEditingRule(undefined)
    form.setFieldsValue(toFormValues())
    setDrawerOpen(true)
  }

  const openEdit = (rule: LogMonitorRule) => {
    setEditingRule(rule)
    form.setFieldsValue(toFormValues(rule))
    setDrawerOpen(true)
  }

  const submit = async (values: RuleFormValues) => {
    setSubmitting(true)
    try {
      const payload = toPayload(values)
      if (editingRule) await updateLogMonitorRule(editingRule.id, payload)
      else await createLogMonitorRule(payload)
      message.success(editingRule ? '日志监控规则已更新' : '日志监控规则已创建')
      setDrawerOpen(false)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '保存日志监控规则失败'))
    } finally {
      setSubmitting(false)
    }
  }

  const runEvaluate = async (rule: LogMonitorRule) => {
    try {
      const result = await evaluateLogMonitorRule(rule.id)
      if (result.triggered) message.warning(`已触发告警：命中 ${result.matchedCount} 条日志`)
      else message.info(result.skippedReason || `未达到阈值：当前命中 ${result.matchedCount} 条`)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '手动评估失败'))
    }
  }

  const removeRule = async (rule: LogMonitorRule) => {
    try {
      await deleteLogMonitorRule(rule.id)
      message.success('日志监控规则已删除')
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '删除日志监控规则失败'))
    }
  }

  const columns: ColumnsType<LogMonitorRule> = [
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
          <Typography.Text type="secondary">{rule.description || '按日志级别、关键字、服务或来源设置条件，命中后写入报警中心'}</Typography.Text>
        </Space>
      ),
    },
    { title: '范围', width: 230, render: (_, rule) => <Space direction="vertical" size={2}><Typography.Text>{rule.service || rule.source || '全部日志'}</Typography.Text><Typography.Text type="secondary">{formatRuleHostScope(rule)}</Typography.Text></Space> },
    { title: '匹配条件', dataIndex: 'keywords', width: 260, render: (_, rule) => renderMatchConditions(rule) },
    { title: '阈值', width: 130, render: (_, rule) => <Typography.Text>{rule.windowMinutes} 分钟 ≥ <Typography.Text strong>{rule.threshold}</Typography.Text> 次</Typography.Text> },
    { title: '周期', width: 260, render: (_, rule) => <Typography.Text type="secondary">{scheduleText(rule)}</Typography.Text> },
    { title: '通知', width: 170, render: (_, rule) => <Space wrap>{rule.notification.channels.map((channel) => <Tag key={channel} color={channel === '站内告警' ? 'blue' : 'purple'}>{channel}</Tag>)}</Space> },
    { title: '触发', width: 120, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text strong>{rule.triggerCount} 次</Typography.Text><Typography.Text type="secondary">{rule.lastTriggeredAt ? new Date(rule.lastTriggeredAt).toLocaleString('zh-CN', { hour12: false }) : '未触发'}</Typography.Text></Space> },
    {
      title: '操作',
      width: 220,
      render: (_, rule) => (
        <Space wrap>
          <Button type="link" onClick={() => setSelectedRule(rule)}>详情</Button>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}>
            <Button type="link" icon={<ExperimentOutlined />} onClick={() => runEvaluate(rule)}>评估</Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}>
            <Button type="link" icon={<EditOutlined />} onClick={() => openEdit(rule)}>编辑</Button>
          </PermissionGate>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}>
            <Popconfirm title="删除日志监控规则？" description="删除后不会影响已产生的告警记录。" onConfirm={() => removeRule(rule)}>
              <Button type="link" danger icon={<DeleteOutlined />}>删除</Button>
            </Popconfirm>
          </PermissionGate>
        </Space>
      ),
    },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Card style={{ overflow: 'hidden', background: 'linear-gradient(135deg, #08111f 0%, #132a3d 52%, #172554 100%)', border: 0 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, alignItems: 'center' }}>
          <div>
            <Typography.Title level={3} style={{ color: '#fff', marginBottom: 8 }}>日志监控</Typography.Title>
            <Typography.Paragraph style={{ color: 'rgba(255,255,255,0.72)', maxWidth: 760, marginBottom: 0 }}>
              按日志级别、关键字、服务、来源和主机范围设置阈值，在指定周期、节假日策略和时间段内自动评估日志；触发后写入告警中心，并可同步推送企业微信或钉钉机器人。
            </Typography.Paragraph>
          </div>
          <PermissionGate permission={PERMISSIONS.LOGS_MANAGE}>
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={openCreate}>新建监控规则</Button>
          </PermissionGate>
        </div>
      </Card>

      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}><Card><Statistic title="规则总数" value={stats.total} prefix={<BellOutlined />} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="启用规则" value={stats.enabled} valueStyle={{ color: '#52c41a' }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="停用规则" value={stats.disabled} valueStyle={{ color: stats.disabled ? '#8c8c8c' : undefined }} /></Card></Col>
        <Col xs={24} md={6}><Card><Statistic title="触发记录" value={stats.triggered} valueStyle={{ color: stats.triggered ? '#faad14' : undefined }} /></Card></Col>
      </Row>

      <Tabs
        items={[
          {
            key: 'logs',
            label: '日志监控规则',
            children: (
              <Space direction="vertical" size="large" style={{ width: '100%' }}>
                <Alert showIcon type="info" message="触发逻辑" description="调度器默认每 30 秒评估一次启用规则。规则命中时会检查冷却期，避免同一条件短时间重复刷屏；系统内置“所有 ERROR 日志告警”规则，会将 ERROR 级别日志写入报警中心。" />
                <Card title="监控规则" extra={<Space><Radio.Group size="small" optionType="button" buttonStyle="solid" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} options={[{ label: `全部 ${stats.total}`, value: 'all' }, { label: `启用 ${stats.enabled}`, value: 'enabled' }, { label: `停用 ${stats.disabled}`, value: 'disabled' }]} /><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button></Space>}>
                  <Table rowKey="id" loading={loading} columns={columns} dataSource={filteredRules} pagination={{ pageSize: 8 }} rowClassName={(rule) => rule.enabled ? '' : 'monitor-rule-disabled-row'} />
                </Card>
                <Card title="最近触发记录">
                  <Table
                    rowKey="id"
                    loading={loading}
                    dataSource={alerts}
                    pagination={{ pageSize: 6 }}
                    columns={[
                      { title: '时间', dataIndex: 'createdAt', width: 190, render: (value) => new Date(value).toLocaleString('zh-CN', { hour12: false }) },
                      { title: '规则', dataIndex: 'ruleId', render: (ruleId) => rules.find((rule) => rule.id === ruleId)?.name || ruleId },
                      { title: '告警ID', dataIndex: 'alertId', render: (value) => <Typography.Text code>{value}</Typography.Text> },
                      { title: '命中次数', dataIndex: 'matchedCount', width: 120, render: (value) => <Typography.Text strong>{value}</Typography.Text> },
                      { title: '匹配关键字', dataIndex: 'matchedKeywords', render: (values: string[]) => <Space wrap>{values.length ? values.map((value) => <Tag key={value}>{value}</Tag>) : <Typography.Text type="secondary">按级别/条件匹配</Typography.Text>}</Space> },
                      { title: '通知结果', dataIndex: 'notificationResults', render: (values: string[]) => values.length ? values.join('；') : '站内告警' },
                    ]}
                  />
                </Card>
              </Space>
            ),
          },
          { key: 'cgi', label: 'CGI/URL 监控', children: <CgiMonitorPanel hosts={hosts} /> },
          { key: 'host-resource', label: '主机资源监控', children: <HostResourceMonitorPanel hosts={hosts} /> },
        ]}
      />

      <Drawer
        title={editingRule ? '编辑日志监控规则' : '新建日志监控规则'}
        width={720}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" loading={submitting} onClick={() => form.submit()}>保存</Button></Space>}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" onFinish={submit} initialValues={toFormValues()}>
          <Row gutter={16}>
            <Col span={16}><Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input placeholder="例如：支付失败关键字突增" /></Form.Item></Col>
            <Col span={8}><Form.Item name="enabled" label="启用状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item></Col>
          </Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} placeholder="说明该规则关注的业务影响和处理建议" /></Form.Item>
          <Row gutter={16}>
            <Col span={12}><Form.Item name="service" label="服务/容器"><Select allowClear showSearch optionFilterProp="label" options={serviceOptions} placeholder="不选则匹配全部服务" /></Form.Item></Col>
            <Col span={12}>
              <Form.Item name="hostScope" label="主机范围" rules={[{ required: true, message: '请选择主机范围' }]}>
                <Radio.Group optionType="button" options={[{ label: '全部主机', value: 'all' }, { label: '单台主机', value: 'single' }, { label: '多台主机', value: 'multiple' }, { label: '主机组', value: 'group' }]} />
              </Form.Item>
            </Col>
          </Row>
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
            <Col span={12}><Form.Item name="source" label="日志来源" tooltip="可选择系统来源，也可直接输入文件/目录路径；支持 %Y%m%d 日期模板，例如 D:\\logs\\CalcFut_%Y%m%d.log。不填则匹配全部已采集日志。"><AutoComplete allowClear options={sourceOptions} placeholder="可选：D:\\logs\\CalcFut_%Y%m%d.log" filterOption={(input, option) => String(option?.label ?? option?.value ?? '').toLowerCase().includes(input.toLowerCase())} /></Form.Item></Col>
            <Col span={12}><Form.Item name="level" label="日志级别"><Select allowClear options={['ERROR', 'WARN', 'INFO', 'DEBUG'].map((level) => ({ label: level, value: level }))} placeholder="不选则匹配全部级别" /></Form.Item></Col>
          </Row>
          <Form.Item
            name="keywordsText"
            label="关键字"
            tooltip="可选。一行一个；也可以不填关键字，只选择日志级别（例如 ERROR）来匹配所有 ERROR 日志。"
            dependencies={['level', 'service', 'source', 'hostScope']}
            rules={[{
              validator: async (_, value) => {
                const level = form.getFieldValue('level')
                const service = form.getFieldValue('service')
                const source = form.getFieldValue('source')
                const scope = form.getFieldValue('hostScope') ?? 'all'
                if (splitLines(value).length || level || service || source || scope !== 'all') return
                throw new Error('请至少填写关键字或选择日志级别/服务/来源/主机范围')
              },
            }]}
          >
            <Input.TextArea rows={4} placeholder={'可留空，仅按 ERROR 级别匹配\nerror\nexception\n支付失败'} />
          </Form.Item>
          <Row gutter={16}>
            <Col span={8}><Form.Item name="threshold" label="触发次数阈值" rules={[{ required: true }]}><InputNumber min={1} max={100000} style={{ width: '100%' }} addonAfter="次" /></Form.Item></Col>
            <Col span={8}><Form.Item name="windowMinutes" label="统计窗口" rules={[{ required: true }]}><InputNumber min={1} max={1440} style={{ width: '100%' }} addonAfter="分钟" /></Form.Item></Col>
            <Col span={8}><Form.Item name="cooldownMinutes" label="冷却期"><InputNumber min={1} max={1440} style={{ width: '100%' }} addonAfter="分钟" /></Form.Item></Col>
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
            description="开启后系统自动维护自愈规则和告警自动处理映射，日志关键字/等级命中告警会触发对应动作。"
            safeDescription="日志告警后会自动写入自愈执行历史和计划动作，不会执行远程命令。"
          />
          <Card size="small" title="通知配置">
            <Form.Item name={['notification', 'channels']} label="通知渠道" rules={[{ required: true, message: '请选择通知渠道' }]}><Checkbox.Group options={['站内告警', '企业微信', '钉钉']} /></Form.Item>
            <Form.Item name={['notification', 'webhookUrl']} label="企业微信/钉钉 Webhook" extra="可选覆盖；不填则使用设置页里的全局告警通知配置。"><Input placeholder="可选：填写后优先使用该规则自己的机器人 Webhook" /></Form.Item>
            <Form.Item name={['notification', 'receivers']} label="负责人/接收人"><Input placeholder="例如：支付 SRE 值班群、张三" /></Form.Item>
          </Card>
        </Form>
      </Drawer>

      <Modal title="规则详情" open={Boolean(selectedRule)} onCancel={() => setSelectedRule(undefined)} footer={null} width={760}>
        {selectedRule && (
          <Descriptions bordered column={1} size="small">
            <Descriptions.Item label="规则名称">{selectedRule.name}</Descriptions.Item>
            <Descriptions.Item label="匹配条件">{renderMatchConditions(selectedRule)}</Descriptions.Item>
            <Descriptions.Item label="触发条件">{selectedRule.windowMinutes} 分钟内出现 ≥ {selectedRule.threshold} 次</Descriptions.Item>
            <Descriptions.Item label="范围">{selectedRule.service || '全部服务'} / {selectedRule.level ? <Tag color={levelColor[selectedRule.level]}>{selectedRule.level}</Tag> : '全部级别'}</Descriptions.Item>
            <Descriptions.Item label="主机范围">{formatRuleHostScope(selectedRule, true)}</Descriptions.Item>
            <Descriptions.Item label="周期">{scheduleText(selectedRule)}</Descriptions.Item>
            <Descriptions.Item label="通知">{selectedRule.notification.channels.join('、')}；{selectedRule.notification.receivers || '未指定接收人'}</Descriptions.Item>
            <Descriptions.Item label="异常自愈">
              {selectedRule.selfHealingBinding?.enabled ? (
                <Space direction="vertical" size={4}>
                  <Space>{selfHealingTag(selectedRule)}<Typography.Text>{selectedRule.selfHealingBinding.actionType} → {selectedRule.selfHealingBinding.targetServiceName || selectedRule.selfHealingBinding.serviceName}</Typography.Text></Space>
                  <Typography.Text type="secondary">目标主机：{selectedRule.selfHealingBinding.targetHostId || '未指定'}；冷却 {selectedRule.selfHealingBinding.cooldownMinutes} 分钟，重试 {selectedRule.selfHealingBinding.retries} 次</Typography.Text>
                  {selectedRule.generatedSelfHealingRuleId && <Typography.Text type="secondary">自愈规则：{selectedRule.generatedSelfHealingRuleId}</Typography.Text>}
                  {selectedRule.generatedAlertHandlingRuleId && <Typography.Text type="secondary">告警映射：{selectedRule.generatedAlertHandlingRuleId}</Typography.Text>}
                </Space>
              ) : '未绑定'}
            </Descriptions.Item>
            <Descriptions.Item label="最近评估">{selectedRule.lastEvaluatedAt ? new Date(selectedRule.lastEvaluatedAt).toLocaleString('zh-CN', { hour12: false }) : '尚未评估'}</Descriptions.Item>
          </Descriptions>
        )}
      </Modal>
    </Space>
  )
}
