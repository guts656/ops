import type { ExternalSeverity } from '../types/alert'

export type WebhookAlertStatus = 'firing' | 'resolved'

export interface NormalizedWebhookAlert {
  source: 'prometheus' | 'zabbix' | 'grafana' | 'generic'
  externalId?: string
  severity: ExternalSeverity
  status: WebhookAlertStatus
  title: string
  content: string
  service?: string
  host?: string
  metadata: Record<string, unknown>
}

function stringValue(value: unknown, fallback = '') {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function severity(value: unknown): ExternalSeverity {
  const normalized = stringValue(value, 'medium').toLowerCase()
  if (['critical', '灾难', '紧急', 'disaster'].includes(normalized)) return 'critical'
  if (['high', '严重', 'error', 'average'].includes(normalized)) return 'high'
  if (['warning', 'warn', 'medium', '警告'].includes(normalized)) return 'medium'
  if (['low', 'info', 'information', '提示'].includes(normalized)) return 'low'
  return 'medium'
}

function status(value: unknown): WebhookAlertStatus {
  const normalized = stringValue(value, 'firing').toLowerCase()
  return ['resolved', 'ok', '0', '恢复', 'recovered'].includes(normalized) ? 'resolved' : 'firing'
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export function adaptPrometheus(payload: unknown): NormalizedWebhookAlert[] {
  const body = record(payload)
  const alerts = Array.isArray(body.alerts) ? body.alerts : [body]
  return alerts.map((raw) => {
    const item = record(raw)
    const labels = record(item.labels)
    const annotations = record(item.annotations)
    const title = stringValue(annotations.summary, stringValue(labels.alertname, 'Prometheus 告警'))
    const content = stringValue(annotations.description, title)
    const service = stringValue(labels.service, stringValue(labels.job, stringValue(labels.instance, 'prometheus')))
    return {
      source: 'prometheus',
      externalId: stringValue(item.fingerprint, stringValue(labels.alertname, title)),
      severity: severity(labels.severity),
      status: status(item.status ?? body.status),
      title,
      content,
      service,
      host: stringValue(labels.instance, undefined as unknown as string),
      metadata: { labels, annotations, startsAt: item.startsAt, endsAt: item.endsAt, generatorURL: item.generatorURL, raw: item },
    }
  })
}

export function adaptGrafana(payload: unknown): NormalizedWebhookAlert[] {
  const body = record(payload)
  const alerts = Array.isArray(body.alerts) ? body.alerts : [body]
  return alerts.map((raw) => {
    const item = record(raw)
    const labels = record(item.labels)
    const annotations = record(item.annotations)
    const ruleName = stringValue(body.ruleName, stringValue(labels.alertname, 'Grafana 告警'))
    const title = stringValue(annotations.summary, ruleName)
    const content = stringValue(annotations.description, stringValue(body.message, title))
    const service = stringValue(labels.service, stringValue(labels.instance, 'grafana'))
    const externalId = stringValue(item.fingerprint, stringValue(body.ruleId, stringValue(body.ruleUid, title)))
    return {
      source: 'grafana',
      externalId,
      severity: severity(labels.severity ?? body.state),
      status: status(item.status ?? body.state),
      title,
      content,
      service,
      host: stringValue(labels.instance, undefined as unknown as string),
      metadata: { labels, annotations, ruleId: body.ruleId, ruleUid: body.ruleUid, dashboardURL: body.dashboardURL, panelURL: body.panelURL, raw: item },
    }
  })
}

export function adaptZabbix(payload: unknown): NormalizedWebhookAlert[] {
  const body = record(payload)
  const eventId = stringValue(body.event_id, stringValue(body.eventId, stringValue(body.eventid, '')))
  const triggerId = stringValue(body.trigger_id, stringValue(body.triggerId, stringValue(body.triggerid, '')))
  const title = stringValue(body.subject, stringValue(body.trigger_name, stringValue(body.name, 'Zabbix 告警')))
  const content = stringValue(body.message, stringValue(body.description, title))
  const service = stringValue(body.service, stringValue(body.host, stringValue(body.hostname, 'zabbix')))
  return [{
    source: 'zabbix',
    externalId: eventId || triggerId || title,
    severity: severity(body.severity ?? body.priority),
    status: status(body.status ?? body.event_status ?? body.value),
    title,
    content,
    service,
    host: stringValue(body.host, stringValue(body.hostname, undefined as unknown as string)),
    metadata: { triggerId, eventId, raw: body },
  }]
}

export function adaptGeneric(payload: unknown): NormalizedWebhookAlert[] {
  const body = record(payload)
  const title = stringValue(body.title, stringValue(body.name, '外部告警'))
  return [{
    source: 'generic',
    externalId: stringValue(body.id, stringValue(body.externalId, title)),
    severity: severity(body.severity ?? body.level),
    status: status(body.status),
    title,
    content: stringValue(body.content, stringValue(body.message, title)),
    service: stringValue(body.service, stringValue(body.host, 'generic')),
    host: stringValue(body.host, undefined as unknown as string),
    metadata: { raw: body },
  }]
}

export function detectWebhookSource(payload: unknown) {
  const body = record(payload)
  if (Array.isArray(body.alerts) && (body.receiver || body.groupLabels)) return 'prometheus'
  if (body.ruleId || body.ruleUid || body.dashboardURL || body.panelURL) return 'grafana'
  if (body.event_id || body.trigger_id || body.trigger_name || body.eventId) return 'zabbix'
  return 'generic'
}

export function adaptWebhook(source: string, payload: unknown): NormalizedWebhookAlert[] {
  const actual = source === 'auto' ? detectWebhookSource(payload) : source
  if (actual === 'prometheus') return adaptPrometheus(payload)
  if (actual === 'grafana') return adaptGrafana(payload)
  if (actual === 'zabbix') return adaptZabbix(payload)
  return adaptGeneric(payload)
}
