import {
  alerts,
  alertTrend,
  buildChatReply,
  buildDiagnosis,
  buildInspectionResult,
  buildRuleConditionText,
  dashboardMetrics,
  logs,
  resourceUsage,
  selfHealingHistory,
  selfHealingRules,
  services,
} from '../utils/mock'

function mockRequest(data, delay = 500) {
  return new Promise((resolve) => {
    window.setTimeout(() => resolve(structuredClone(data)), delay)
  })
}

export function getDashboardData() {
  return mockRequest({
    metrics: dashboardMetrics,
    resources: resourceUsage,
    services,
    alertTrend,
    alerts,
  })
}

export function getAlerts() {
  return mockRequest(alerts)
}

export function diagnoseAlert(alert) {
  return mockRequest({ alertId: alert.id, result: buildDiagnosis(alert) }, 800)
}

export function sendChatMessage(message) {
  return mockRequest({ role: 'assistant', content: buildChatReply(message) }, 700)
}

export function runInspection(prompt) {
  return mockRequest(buildInspectionResult(prompt), 900)
}

export function queryLogs(filters = {}) {
  const keyword = filters.keyword?.trim().toLowerCase()
  const filtered = logs.filter((log) => {
    const matchesKeyword = keyword
      ? [log.service, log.level, log.traceId, log.message].some((value) => value.toLowerCase().includes(keyword))
      : true
    const matchesService = filters.service ? log.service === filters.service : true
    const matchesLevel = filters.level ? log.level === filters.level : true
    return matchesKeyword && matchesService && matchesLevel
  })
  return mockRequest(filtered, 450)
}

export function getSelfHealingRules() {
  return mockRequest(selfHealingRules.map((rule) => ({ ...rule, conditionText: buildRuleConditionText(rule) })), 450)
}

export function getSelfHealingHistory(filters = {}) {
  const filtered = selfHealingHistory.filter((item) => (filters.ruleId ? item.ruleId === filters.ruleId : true))
  return mockRequest(filtered, 450)
}

export function exportSelfHealingLogs(history) {
  return mockRequest(JSON.stringify(history, null, 2), 300)
}
