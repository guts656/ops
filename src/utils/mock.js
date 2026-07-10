export const dashboardMetrics = [
  {
    key: 'health',
    title: '系统健康度',
    value: '98.5%',
    trend: '核心链路健康',
    trendType: 'up',
    color: '#52c41a',
  },
  {
    key: 'alerts',
    title: '今日告警',
    value: 12,
    trend: '较昨日 -20%',
    trendType: 'down',
    color: '#ff4d4f',
  },
  {
    key: 'latency',
    title: '平均响应时间',
    value: '234ms',
    trend: '较昨日 +15ms',
    trendType: 'danger',
    color: '#faad14',
  },
  {
    key: 'availability',
    title: '可用性',
    value: '99.95%',
    trend: 'SLO 达标',
    trendType: 'up',
    color: '#1677ff',
  },
]

export const resourceUsage = [
  { name: 'CPU 使用率', value: 67, status: 'active' },
  { name: '内存使用率', value: 54, status: 'normal' },
  { name: '磁盘使用率', value: 41, status: 'normal' },
]

export const services = [
  { key: 'payment', name: 'payment-service', status: '异常', instances: 4, qps: 1280, errorRate: '3.82%' },
  { key: 'order', name: 'order-service', status: '警告', instances: 8, qps: 2450, errorRate: '0.91%' },
  { key: 'gateway', name: 'gateway-service', status: '警告', instances: 6, qps: 5320, errorRate: '0.48%' },
  { key: 'user', name: 'user-service', status: '健康', instances: 10, qps: 3180, errorRate: '0.08%' },
  { key: 'inventory', name: 'inventory-service', status: '健康', instances: 5, qps: 860, errorRate: '0.04%' },
  { key: 'notification', name: 'notification-service', status: '健康', instances: 3, qps: 420, errorRate: '0.02%' },
]

export const alertTrend = [
  { date: '05/16', value: 18 },
  { date: '05/17', value: 15 },
  { date: '05/18', value: 21 },
  { date: '05/19', value: 13 },
  { date: '05/20', value: 16 },
  { date: '05/21', value: 10 },
  { date: '05/22', value: 12 },
]

export const alerts = [
  {
    id: 'ALT-1001',
    level: '紧急',
    time: '10:42:18',
    service: 'payment-service',
    content: '支付成功率低于 95%，疑似第三方通道异常',
    owner: '周岚',
    status: '待处理',
  },
  {
    id: 'ALT-1002',
    level: '严重',
    time: '10:35:44',
    service: 'gateway-service',
    content: '入口 P95 延迟持续超过 800ms',
    owner: '陈默',
    status: '处理中',
  },
  {
    id: 'ALT-1003',
    level: '警告',
    time: '10:28:09',
    service: 'order-service',
    content: '订单队列堆积超过 8,000 条',
    owner: '何予',
    status: '待处理',
  },
  {
    id: 'ALT-1004',
    level: '提示',
    time: '10:21:36',
    service: 'inventory-service',
    content: '库存同步任务耗时较基线增加 12%',
    owner: '林若辰',
    status: '已解决',
  },
  {
    id: 'ALT-1005',
    level: '警告',
    time: '10:16:55',
    service: 'notification-service',
    content: '短信供应商返回码波动，自动降级已触发',
    owner: '唐安',
    status: '处理中',
  },
]

export const logs = [
  { id: 'LOG-1001', time: '2026-05-22 10:42:18', service: 'payment-service', level: 'ERROR', traceId: 'trc-pay-8f21', message: 'payment callback failed: upstream channel timeout after 3000ms' },
  { id: 'LOG-1002', time: '2026-05-22 10:41:55', service: 'gateway-service', level: 'WARN', traceId: 'trc-gw-91ad', message: 'p95 latency exceeded threshold, current value 842ms' },
  { id: 'LOG-1003', time: '2026-05-22 10:40:12', service: 'order-service', level: 'WARN', traceId: 'trc-ord-32aa', message: 'consumer lag detected, pending messages 8240' },
  { id: 'LOG-1004', time: '2026-05-22 10:39:27', service: 'user-service', level: 'INFO', traceId: 'trc-user-120c', message: 'login traffic increased 9 percent compared with baseline' },
  { id: 'LOG-1005', time: '2026-05-22 10:38:45', service: 'inventory-service', level: 'INFO', traceId: 'trc-inv-7c8d', message: 'inventory sync completed in 1280ms' },
  { id: 'LOG-1006', time: '2026-05-22 10:37:11', service: 'notification-service', level: 'WARN', traceId: 'trc-msg-5ef1', message: 'sms provider response code unstable, fallback provider enabled' },
  { id: 'LOG-1007', time: '2026-05-22 10:36:05', service: 'payment-service', level: 'ERROR', traceId: 'trc-pay-77d2', message: 'payment success rate dropped below 95 percent in rolling window' },
  { id: 'LOG-1008', time: '2026-05-22 10:34:49', service: 'gateway-service', level: 'INFO', traceId: 'trc-gw-44b0', message: 'route config reloaded successfully' },
  { id: 'LOG-1009', time: '2026-05-22 10:33:16', service: 'order-service', level: 'DEBUG', traceId: 'trc-ord-0081', message: 'order state transition completed: CREATED -> PAID' },
  { id: 'LOG-1010', time: '2026-05-22 10:31:02', service: 'inventory-service', level: 'WARN', traceId: 'trc-inv-54ad', message: 'stock sync duration increased by 12 percent' },
]

export const initialMessages = [
  {
    role: 'assistant',
    content: '你好，我是 OpsHub AI 助手。你可以询问告警原因、巡检建议、服务状态或应急处理步骤。',
  },
]

export const inspectionTemplates = [
  '检查生产环境 payment-service 的错误率和延迟',
  '巡检 DCORE OFFICE 分组下所有 SSH 主机磁盘使用率',
  '检查过去 30 分钟网关服务是否有异常流量',
]

export const selfHealingRules = [
  {
    id: 'heal-001',
    name: '支付服务错误率自动重启',
    description: '当 payment-service 错误率持续高于阈值时自动重启服务并通知 SRE。',
    priority: 'P0',
    enabled: true,
    triggerCount: 18,
    successRate: 94,
    lastExecutedAt: '2026-05-22 10:42:18',
    logic: 'AND',
    conditions: [
      { dataSource: '指标', metric: 'error_rate', service: 'payment-service', operator: '>', threshold: 3, windowValue: 5, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' },
      { dataSource: '事件', metric: 'instance_unhealthy', service: 'payment-service', operator: '>=', threshold: 2, windowValue: 3, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' },
    ],
    actions: [
      { type: '重启服务', target: 'payment-service', retries: 2, cooldown: 10 },
      { type: '发通知', target: 'sre-payment', retries: 1, cooldown: 1 },
    ],
    notification: { channels: ['钉钉', '邮件'], receivers: 'payment-sre@example.com, 周岚', template: '规则 {{ruleName}} 已触发，服务 {{service}} 当前值 {{value}}。' },
  },
  {
    id: 'heal-002',
    name: '网关延迟自动扩容',
    description: '入口 P95 延迟升高时自动扩容 gateway-service 实例。',
    priority: 'P1',
    enabled: true,
    triggerCount: 11,
    successRate: 89,
    lastExecutedAt: '2026-05-22 10:35:44',
    logic: 'AND',
    conditions: [
      { dataSource: '指标', metric: 'p95_latency', service: 'gateway-service', operator: '>=', threshold: 800, windowValue: 10, windowUnit: '分钟', intervalValue: 1, intervalUnit: '分钟' },
    ],
    actions: [
      { type: '扩缩容', target: 'gateway-service replicas +2', retries: 1, cooldown: 15 },
    ],
    notification: { channels: ['企业微信'], receivers: '网关值班群', template: '{{service}} 延迟超过阈值，已执行扩容。' },
  },
  {
    id: 'heal-003',
    name: '订单队列堆积消费加速',
    description: '订单队列堆积时执行消费者扩容脚本。',
    priority: 'P1',
    enabled: true,
    triggerCount: 9,
    successRate: 92,
    lastExecutedAt: '2026-05-22 10:28:09',
    logic: 'OR',
    conditions: [
      { dataSource: '指标', metric: 'queue_lag', service: 'order-service', operator: '>', threshold: 8000, windowValue: 5, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' },
      { dataSource: '日志', metric: 'consumer_lag_detected', service: 'order-service', operator: '==', threshold: 1, windowValue: 2, windowUnit: '分钟', intervalValue: 30, intervalUnit: '秒' },
    ],
    actions: [
      { type: '执行脚本', target: '/opt/scripts/scale-order-consumer.sh', retries: 2, cooldown: 8 },
      { type: '发通知', target: 'order-oncall', retries: 1, cooldown: 1 },
    ],
    notification: { channels: ['钉钉'], receivers: '何予, 订单值班群', template: '{{ruleName}} 已处理，当前堆积 {{value}}。' },
  },
  {
    id: 'heal-004',
    name: '通知服务供应商降级',
    description: '短信供应商错误码波动时切换备用通道。',
    priority: 'P2',
    enabled: false,
    triggerCount: 6,
    successRate: 83,
    lastExecutedAt: '2026-05-21 18:12:33',
    logic: 'AND',
    conditions: [
      { dataSource: '日志', metric: 'sms_provider_unstable', service: 'notification-service', operator: '==', threshold: 1, windowValue: 3, windowUnit: '分钟', intervalValue: 1, intervalUnit: '分钟' },
    ],
    actions: [
      { type: '执行脚本', target: '/opt/scripts/switch-sms-provider.sh', retries: 1, cooldown: 20 },
    ],
    notification: { channels: ['邮件'], receivers: '唐安', template: '通知服务已切换短信备用供应商。' },
  },
]

export const selfHealingHistory = [
  {
    id: 'exec-1001',
    ruleId: 'heal-001',
    ruleName: '支付服务错误率自动重启',
    service: 'payment-service',
    status: '成功',
    triggeredAt: '2026-05-22 10:42:18',
    triggerValue: 'error_rate=3.82%',
    duration: '48s',
    logs: ['检测到 error_rate 3.82% > 3%', '确认 2 个实例异常', '重启 payment-service 第 1 批实例', '健康检查通过', '发送钉钉和邮件通知'],
  },
  {
    id: 'exec-1002',
    ruleId: 'heal-002',
    ruleName: '网关延迟自动扩容',
    service: 'gateway-service',
    status: '成功',
    triggeredAt: '2026-05-22 10:35:44',
    triggerValue: 'p95_latency=842ms',
    duration: '1m 12s',
    logs: ['P95 延迟超过 800ms', '扩容 gateway-service replicas +2', '等待新实例 Ready', '流量重新均衡完成'],
  },
  {
    id: 'exec-1003',
    ruleId: 'heal-003',
    ruleName: '订单队列堆积消费加速',
    service: 'order-service',
    status: '成功',
    triggeredAt: '2026-05-22 10:28:09',
    triggerValue: 'queue_lag=8240',
    duration: '35s',
    logs: ['队列堆积超过阈值', '执行 /opt/scripts/scale-order-consumer.sh', '消费者实例增加到 12', '发送通知'],
  },
  {
    id: 'exec-1004',
    ruleId: 'heal-004',
    ruleName: '通知服务供应商降级',
    service: 'notification-service',
    status: '失败',
    triggeredAt: '2026-05-21 18:12:33',
    triggerValue: 'sms_provider_unstable=1',
    duration: '22s',
    logs: ['检测到短信供应商波动', '执行备用通道切换脚本', '脚本返回非零退出码', '已通知值班人员人工处理'],
  },
]

export function buildRuleConditionText(rule) {
  return rule.conditions
    .map((condition) => `${condition.service}.${condition.metric} ${condition.operator} ${condition.threshold}（${condition.windowValue}${condition.windowUnit}）`)
    .join(` ${rule.logic} `)
}

export function buildDiagnosis(alert) {
  return `AI 诊断结果：${alert.service} 的「${alert.content}」建议优先检查最近发布、上游依赖健康度和资源水位。建议操作：1）查看服务日志关键错误；2）比对近 30 分钟 QPS 与错误率；3）必要时执行回滚或扩容。`
}

export function buildChatReply(input) {
  return `已收到：“${input}”。基于当前 Mock 监控数据，建议先查看 payment-service、gateway-service 的告警，再结合 CPU/内存水位和最近发布记录定位根因。`
}

export function buildInspectionResult(input) {
  return {
    summary: `已根据“${input}”生成巡检结果。`,
    items: [
      { name: '资源水位', status: '通过', detail: 'CPU 67%，内存 54%，磁盘 41%，均未超过阈值。' },
      { name: '服务健康', status: '需关注', detail: 'payment-service 当前异常，gateway-service 与 order-service 处于警告状态。' },
      { name: '告警趋势', status: '通过', detail: '今日告警 12 条，较昨日下降 20%。' },
    ],
  }
}
