import { ClockCircleOutlined, DeleteOutlined, EditOutlined, ExperimentOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { Button, Card, Checkbox, Col, Descriptions, Drawer, Flex, Form, Input, InputNumber, Popconfirm, Radio, Row, Select, Space, Statistic, Switch, Table, Tag, Typography, message } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { createIpushMonitorRule, deleteIpushMonitorRule, evaluateIpushMonitorRule, listIpushMonitorAlerts, listIpushMonitorRules, updateIpushMonitorRule } from '../../api/ipushMonitors'
import { getErrorMessage } from '../../api/http'
import { PERMISSIONS } from '../../config/permissions'
import type { Host } from '../../types/host'
import type { IpushMonitorAlertRecord, IpushMonitorRule, IpushMonitorRuleInput, IpushMonitorTimeRange } from '../../types/ipushMonitor'
import { formatShanghaiTime } from '../../utils/time'
import PermissionGate from '../auth/PermissionGate'

type RuleStatusFilter = 'all' | 'enabled' | 'disabled'
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

interface RuleFormValues extends Omit<IpushMonitorRuleInput, 'holidays' | 'notification'> {
  holidaysText?: string
  notification?: { receivers?: string }
}

function splitLines(value?: string) {
  return (value || '').split(/\n|,/).map((item) => item.trim()).filter(Boolean)
}

function defaultValues(): Partial<RuleFormValues> {
  return {
    enabled: true,
    systemCode: 'ICE',
    serviceCode: 'QuoteSvcGQ',
    expectedGreeting: 'xinit',
    expectedLoginResult: 'xaucode 200_login_ok',
    connectTimeoutMs: 5000,
    responseTimeoutMs: 5000,
    intervalSeconds: 60,
    failureThreshold: 3,
    cooldownMinutes: 30,
    alertLevel: '严重',
    daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
    timeRanges: [{ start: '00:00', end: '23:59' }],
    holidayMode: 'ignore',
    notification: { receivers: '' },
  }
}

function toFormValues(rule?: IpushMonitorRule): Partial<RuleFormValues> {
  if (!rule) return defaultValues()
  return { ...rule, password: '', holidaysText: rule.holidays.join('\n'), notification: rule.notification }
}

function toPayload(values: RuleFormValues): IpushMonitorRuleInput {
  return {
    ...values,
    hostId: values.hostId || null,
    password: values.password?.trim() || undefined,
    holidays: splitLines(values.holidaysText),
    timeRanges: (values.timeRanges || []).filter((range) => range?.start && range?.end),
    notification: { receivers: values.notification?.receivers },
  }
}

function stageText(stage?: string) {
  if (stage === 'connect') return 'TCP连接'
  if (stage === 'greeting') return '等待xinit'
  if (stage === 'login') return 'xlogin认证'
  if (stage === 'healthy') return '健康'
  return stage || '未检测'
}

function scheduleText(rule: IpushMonitorRule) {
  const days = rule.daysOfWeek.length ? rule.daysOfWeek.map((day) => dayOptions.find((item) => item.value === day)?.label).join('、') : '每天'
  const ranges = rule.timeRanges.length ? rule.timeRanges.map((range) => `${range.start}-${range.end}`).join('、') : '全天'
  return `${days} · ${ranges}`
}

export default function IpushMonitorPanel({ hosts }: { hosts: Host[] }) {
  const [rules, setRules] = useState<IpushMonitorRule[]>([])
  const [alerts, setAlerts] = useState<IpushMonitorAlertRecord[]>([])
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [testingId, setTestingId] = useState<string>()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editingRule, setEditingRule] = useState<IpushMonitorRule>()
  const [selectedRule, setSelectedRule] = useState<IpushMonitorRule>()
  const [statusFilter, setStatusFilter] = useState<RuleStatusFilter>('all')
  const [search, setSearch] = useState('')
  const deferredSearch = useDeferredValue(search)
  const [form] = Form.useForm<RuleFormValues>()

  const hostById = Object.fromEntries(hosts.map((host) => [host.id, host]))
  const hostOptions = hosts.map((host) => ({ label: `${host.hostname || '未命名主机'} - ${host.ip}`, value: host.id }))

  const load = async () => {
    setLoading(true)
    try {
      const [nextRules, nextAlerts] = await Promise.all([listIpushMonitorRules(), listIpushMonitorAlerts()])
      setRules(nextRules)
      setAlerts(nextAlerts)
    } finally { setLoading(false) }
  }

  useEffect(() => { void load() }, [])

  const stats = useMemo(() => ({
    total: rules.length,
    enabled: rules.filter((rule) => rule.enabled).length,
    healthy: rules.filter((rule) => rule.lastStage === 'healthy' && rule.consecutiveFailures === 0).length,
    unhealthy: rules.filter((rule) => rule.consecutiveFailures > 0).length,
  }), [rules])

  const filteredRules = useMemo(() => {
    const keyword = deferredSearch.trim().toLowerCase()
    return rules.filter((rule) => {
      if (statusFilter === 'enabled' && !rule.enabled) return false
      if (statusFilter === 'disabled' && rule.enabled) return false
      if (!keyword) return true
      const host = rule.hostId ? hostById[rule.hostId] : undefined
      return [rule.name, rule.targetHost, rule.port, rule.systemCode, rule.serviceCode, rule.username, host?.hostname, host?.ip].filter(Boolean).join(' ').toLowerCase().includes(keyword)
    })
  }, [deferredSearch, hostById, rules, statusFilter])

  const openCreate = () => {
    setEditingRule(undefined)
    form.setFieldsValue(defaultValues())
    setDrawerOpen(true)
  }

  const openEdit = (rule: IpushMonitorRule) => {
    setEditingRule(rule)
    form.setFieldsValue(toFormValues(rule))
    setDrawerOpen(true)
  }

  const submit = async (values: RuleFormValues) => {
    setSubmitting(true)
    try {
      if (editingRule) await updateIpushMonitorRule(editingRule.id, toPayload(values))
      else await createIpushMonitorRule(toPayload(values))
      message.success(editingRule ? 'iPush监控规则已更新' : 'iPush监控规则已创建')
      setDrawerOpen(false)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, '保存iPush监控规则失败'))
    } finally { setSubmitting(false) }
  }

  const evaluate = async (rule: IpushMonitorRule) => {
    setTestingId(rule.id)
    try {
      const result = await evaluateIpushMonitorRule(rule.id)
      if (!result.checked) message.info(result.skippedReason || '本次未检测')
      else if (result.ok) message.success(`iPush登录正常，耗时 ${result.latencyMs}ms`)
      else message.warning(`${stageText(result.stage)}异常：${result.errorMessage || '检测失败'}；连续失败 ${result.consecutiveFailures} 次`)
      await load()
    } catch (error) {
      message.error(getErrorMessage(error, 'iPush检测失败'))
    } finally { setTestingId(undefined) }
  }

  const remove = async (rule: IpushMonitorRule) => {
    try {
      await deleteIpushMonitorRule(rule.id)
      message.success('iPush监控规则已删除')
      await load()
    } catch (error) { message.error(getErrorMessage(error, '删除iPush监控规则失败')) }
  }

  const columns: ColumnsType<IpushMonitorRule> = [
    { title: '状态', width: 100, render: (_, rule) => !rule.enabled ? <Tag>停用</Tag> : rule.lastStage === 'healthy' ? <Tag color="green">正常</Tag> : rule.lastCheckedAt ? <Tag color="red">异常</Tag> : <Tag color="blue">待检测</Tag> },
    { title: '规则', render: (_, rule) => <Space direction="vertical" size={2}><Space wrap><Typography.Text strong>{rule.name}</Typography.Text><Tag color={alertLevelColor[rule.alertLevel]}>{rule.alertLevel}</Tag></Space><Typography.Text type="secondary" copyable>{rule.targetHost}:{rule.port}</Typography.Text>{rule.hostId && <Typography.Text type="secondary">{hostById[rule.hostId] ? `${hostById[rule.hostId].hostname} - ${hostById[rule.hostId].ip}` : '关联主机已删除'}</Typography.Text>}</Space> },
    { title: '登录参数', width: 240, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text>{rule.systemCode} · {rule.serviceCode}</Typography.Text><Typography.Text type="secondary">账号：{rule.username} · 密码已加密</Typography.Text></Space> },
    { title: '检查策略', width: 180, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text>每 {rule.intervalSeconds} 秒</Typography.Text><Typography.Text type="secondary">连续 {rule.failureThreshold} 次告警</Typography.Text></Space> },
    { title: '最近结果', width: 220, render: (_, rule) => <Space direction="vertical" size={0}><Typography.Text type={rule.consecutiveFailures ? 'danger' : undefined}>{stageText(rule.lastStage)} · {rule.lastLatencyMs ?? '-'}ms</Typography.Text><Typography.Text type="secondary">{rule.lastCheckedAt ? formatShanghaiTime(rule.lastCheckedAt) : '尚未检测'} · 失败 {rule.consecutiveFailures} 次</Typography.Text></Space> },
    { title: '触发', width: 110, render: (_, rule) => <Typography.Text strong>{rule.triggerCount} 次</Typography.Text> },
    { title: '操作', width: 220, fixed: 'right', render: (_, rule) => <Space wrap><Button type="link" onClick={() => setSelectedRule(rule)}>详情</Button><PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Button type="link" icon={<ExperimentOutlined />} loading={testingId === rule.id} onClick={() => evaluate(rule)}>检测</Button><Button type="link" icon={<EditOutlined />} onClick={() => openEdit(rule)}>编辑</Button><Popconfirm title="删除iPush监控规则？" description="规则配置、加密密码和iPush检测历史将删除，告警中心记录仍保留。" onConfirm={() => remove(rule)}><Button type="link" danger icon={<DeleteOutlined />}>删除</Button></Popconfirm></PermissionGate></Space> },
  ]

  return (
    <Space direction="vertical" size="large" style={{ width: '100%' }}>
      <Row gutter={[16, 16]}>
        <Col xs={12} lg={6}><Card><Statistic title="规则总数" value={stats.total} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="启用规则" value={stats.enabled} valueStyle={{ color: '#1677ff' }} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="当前正常" value={stats.healthy} valueStyle={{ color: '#389e0d' }} /></Card></Col>
        <Col xs={12} lg={6}><Card><Statistic title="当前异常" value={stats.unhealthy} valueStyle={{ color: stats.unhealthy ? '#cf1322' : undefined }} /></Card></Col>
      </Row>

      <Card title="iPush监控规则" extra={<Space><Radio.Group size="small" optionType="button" buttonStyle="solid" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} options={[{ label: '全部', value: 'all' }, { label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]} /><Button icon={<ReloadOutlined />} onClick={load}>刷新</Button><PermissionGate permission={PERMISSIONS.LOGS_MANAGE}><Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新建iPush监控</Button></PermissionGate></Space>}>
        <Flex justify="space-between" align="center" gap="middle" wrap style={{ marginBottom: 16 }}><Input.Search allowClear placeholder="搜索规则/主机/IP/端口/账号" value={search} onChange={(event) => setSearch(event.target.value)} style={{ maxWidth: 420 }} /><Typography.Text type="secondary">显示 {filteredRules.length}/{rules.length}</Typography.Text></Flex>
        <Table rowKey="id" loading={loading} columns={columns} dataSource={filteredRules} pagination={{ pageSize: 8 }} scroll={{ x: 1250 }} rowClassName={(rule) => rule.enabled ? '' : 'monitor-rule-disabled-row'} />
      </Card>

      <Card title="最近iPush告警记录">
        <Table rowKey="id" loading={loading} dataSource={alerts} pagination={{ pageSize: 6 }} scroll={{ x: 900 }} columns={[
          { title: '时间', dataIndex: 'createdAt', width: 190, render: (value) => formatShanghaiTime(value) },
          { title: '规则', dataIndex: 'ruleId', render: (ruleId) => rules.find((rule) => rule.id === ruleId)?.name || '规则已删除' },
          { title: '失败阶段', dataIndex: 'stage', width: 130, render: stageText },
          { title: '耗时', dataIndex: 'latencyMs', width: 100, render: (value) => `${value ?? '-'}ms` },
          { title: '异常原因', dataIndex: 'errorMessage', render: (value) => value || '-' },
          { title: '通知结果', dataIndex: 'notificationResults', render: (values: string[]) => values?.length ? values.join('；') : '无外部通知' },
        ]} />
      </Card>

      <Drawer title={editingRule ? '编辑iPush监控' : '新建iPush监控'} width="min(820px, 96vw)" open={drawerOpen} onClose={() => setDrawerOpen(false)} destroyOnHidden extra={<Space><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" loading={submitting} onClick={() => form.submit()}>保存</Button></Space>}>
        <Form form={form} layout="vertical" initialValues={defaultValues()} onFinish={submit}>
          <Row gutter={16}><Col xs={24} md={16}><Form.Item name="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]}><Input placeholder="例如：行情iPush登录监控" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="enabled" label="启用状态" valuePropName="checked"><Switch checkedChildren="启用" unCheckedChildren="停用" /></Form.Item></Col></Row>
          <Form.Item name="description" label="说明"><Input.TextArea rows={2} placeholder="异常后的影响和处理负责人" /></Form.Item>
          <Form.Item name="hostId" label="关联平台主机" extra="可选。关联后使用主机标签展示，主机维护期间抑制该规则告警。"><Select allowClear showSearch optionFilterProp="label" options={hostOptions} placeholder="可不关联，直接填写目标地址" onChange={(hostId) => { const host = hostId ? hostById[hostId] : undefined; if (host) form.setFieldValue('targetHost', host.ip) }} /></Form.Item>
          <Row gutter={16}><Col xs={24} md={16}><Form.Item name="targetHost" label="目标主机/IP" rules={[{ required: true, message: '请输入目标主机或IP' }]}><Input placeholder="172.29.20.10" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="port" label="端口" rules={[{ required: true, message: '请输入端口' }]}><InputNumber min={1} max={65535} style={{ width: '100%' }} /></Form.Item></Col></Row>

          <Card size="small" title="xlogin登录参数" style={{ marginBottom: 16 }}>
            <Row gutter={16}><Col xs={24} md={12}><Form.Item name="systemCode" label="系统标识" rules={[{ required: true }]}><Input placeholder="ICE" /></Form.Item></Col><Col xs={24} md={12}><Form.Item name="serviceCode" label="服务标识" rules={[{ required: true }]}><Input placeholder="QuoteSvcGQ" /></Form.Item></Col></Row>
            <Row gutter={16}><Col xs={24} md={12}><Form.Item name="username" label="账号" rules={[{ required: true }]}><Input autoComplete="off" placeholder="monitor_user" /></Form.Item></Col><Col xs={24} md={12}><Form.Item name="password" label="密码" rules={editingRule ? [] : [{ required: true, message: '请输入密码' }]} extra={editingRule ? '留空表示保留原密码' : undefined}><Input.Password autoComplete="new-password" placeholder={editingRule ? '留空保留原密码' : '请输入密码'} /></Form.Item></Col></Row>
          </Card>

          <Row gutter={16}><Col xs={24} md={12}><Form.Item name="expectedGreeting" label="连接成功标识" rules={[{ required: true }]}><Input placeholder="xinit" /></Form.Item></Col><Col xs={24} md={12}><Form.Item name="expectedLoginResult" label="登录成功标识" rules={[{ required: true }]}><Input placeholder="xaucode 200_login_ok" /></Form.Item></Col></Row>
          <Row gutter={16}><Col xs={12} md={6}><Form.Item name="connectTimeoutMs" label="连接超时"><InputNumber min={500} max={60000} addonAfter="ms" style={{ width: '100%' }} /></Form.Item></Col><Col xs={12} md={6}><Form.Item name="responseTimeoutMs" label="响应超时"><InputNumber min={500} max={60000} addonAfter="ms" style={{ width: '100%' }} /></Form.Item></Col><Col xs={12} md={6}><Form.Item name="intervalSeconds" label="检查间隔"><InputNumber min={10} max={86400} addonAfter="秒" style={{ width: '100%' }} /></Form.Item></Col><Col xs={12} md={6}><Form.Item name="failureThreshold" label="失败阈值"><InputNumber min={1} max={100} addonAfter="次" style={{ width: '100%' }} /></Form.Item></Col></Row>
          <Row gutter={16}><Col xs={24} md={8}><Form.Item name="cooldownMinutes" label="冷却期"><InputNumber min={1} max={1440} addonAfter="分钟" style={{ width: '100%' }} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="alertLevel" label="告警级别"><Select options={['紧急', '严重', '警告', '提示'].map((level) => ({ label: level, value: level }))} /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="daysOfWeek" label="生效周期"><Checkbox.Group options={dayOptions} /></Form.Item></Col></Row>
          <Card size="small" title={<Space><ClockCircleOutlined />时间段</Space>} style={{ marginBottom: 16 }}><Form.List name="timeRanges">{(fields, { add, remove }) => <Space direction="vertical" style={{ width: '100%' }}>{fields.map((field) => <Flex key={field.key} gap="small" align="center"><Form.Item {...field} name={[field.name, 'start']} style={{ flex: 1, marginBottom: 0 }}><Input placeholder="开始 HH:mm" /></Form.Item><span>至</span><Form.Item {...field} name={[field.name, 'end']} style={{ flex: 1, marginBottom: 0 }}><Input placeholder="结束 HH:mm" /></Form.Item><Button danger onClick={() => remove(field.name)}>删除</Button></Flex>)}<Button onClick={() => add({ start: '09:00', end: '18:00' })}>添加时间段</Button></Space>}</Form.List></Card>
          <Row gutter={16}><Col xs={24} md={10}><Form.Item name="holidayMode" label="节假日策略"><Select options={[{ label: '不判断节假日', value: 'ignore' }, { label: '仅节假日生效', value: 'include' }, { label: '排除节假日', value: 'exclude' }]} /></Form.Item></Col><Col xs={24} md={14}><Form.Item name="holidaysText" label="节假日日期"><Input.TextArea rows={3} placeholder={'2026-10-01\n2026-10-02'} /></Form.Item></Col></Row>
          <Form.Item name={['notification', 'receivers']} label="告警负责人"><Input placeholder="例如：行情值班组、张三" /></Form.Item>
        </Form>
      </Drawer>

      <Drawer title="iPush监控详情" width="min(720px, 96vw)" open={Boolean(selectedRule)} onClose={() => setSelectedRule(undefined)} destroyOnHidden>
        {selectedRule && <Descriptions bordered size="small" column={1}>
          <Descriptions.Item label="规则">{selectedRule.name}</Descriptions.Item>
          <Descriptions.Item label="目标"><Typography.Text copyable>{selectedRule.targetHost}:{selectedRule.port}</Typography.Text></Descriptions.Item>
          <Descriptions.Item label="关联主机">{selectedRule.hostId && hostById[selectedRule.hostId] ? `${hostById[selectedRule.hostId].hostname} - ${hostById[selectedRule.hostId].ip}` : '未关联'}</Descriptions.Item>
          <Descriptions.Item label="xlogin参数">{selectedRule.systemCode} · {selectedRule.serviceCode} · {selectedRule.username} · ******</Descriptions.Item>
          <Descriptions.Item label="成功条件">{selectedRule.expectedGreeting} → xlogin → {selectedRule.expectedLoginResult}</Descriptions.Item>
          <Descriptions.Item label="检查策略">每 {selectedRule.intervalSeconds} 秒，连续失败 {selectedRule.failureThreshold} 次触发，冷却 {selectedRule.cooldownMinutes} 分钟</Descriptions.Item>
          <Descriptions.Item label="周期">{scheduleText(selectedRule)}</Descriptions.Item>
          <Descriptions.Item label="最近结果">{stageText(selectedRule.lastStage)} / {selectedRule.lastLatencyMs ?? '-'}ms / {selectedRule.lastError || '正常'}</Descriptions.Item>
          <Descriptions.Item label="脱敏响应"><Typography.Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{selectedRule.lastResponseSnippet || '-'}</Typography.Text></Descriptions.Item>
        </Descriptions>}
      </Drawer>
    </Space>
  )
}
