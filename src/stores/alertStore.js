import { create } from 'zustand'
import { acknowledgeAlert, createAlert, diagnoseAlert, getAlertNoiseStats, getAlertSummary, listSuppressedAlerts, queryAlerts, resolveAlert, suppressAlertFingerprint, unsuppressAlertFingerprint } from '../api/alerts'

function replaceAlert(alerts, updated) {
  return alerts.map((alert) => (alert.id === updated.id ? updated : alert))
}

const defaultFilters = { includeSuppressed: false }

export const useAlertStore = create((set, get) => ({
  alerts: [],
  filters: defaultFilters,
  summary: null,
  noiseStats: null,
  suppressedAlerts: [],
  selectedAlert: null,
  detailOpen: false,
  loading: false,
  noiseLoading: false,
  saving: false,
  diagnosingId: null,
  diagnosis: null,
  setFilters(filters) {
    set({ filters: { ...get().filters, ...filters } })
  },
  openDetail(alert) {
    set({ selectedAlert: alert, detailOpen: true })
  },
  closeDetail() {
    set({ selectedAlert: null, detailOpen: false })
  },
  async load(filters = get().filters) {
    const nextFilters = { ...get().filters, ...filters }
    set({ loading: true, filters: nextFilters })
    try {
      const alerts = await queryAlerts(nextFilters)
      set({ alerts })
    } finally {
      set({ loading: false })
    }
  },
  async loadSummary() {
    const summary = await getAlertSummary()
    set({ summary })
  },
  async loadNoiseStats() {
    const noiseStats = await getAlertNoiseStats()
    set({ noiseStats })
  },
  async loadSuppressedAlerts() {
    set({ noiseLoading: true })
    try {
      const suppressedAlerts = await listSuppressedAlerts()
      set({ suppressedAlerts })
    } finally {
      set({ noiseLoading: false })
    }
  },
  async refreshOverview() {
    await Promise.all([get().loadSummary(), get().loadNoiseStats()])
  },
  async create(input) {
    set({ saving: true })
    try {
      const result = await createAlert(input)
      await Promise.all([get().load(), get().refreshOverview(), get().loadSuppressedAlerts()])
      return result
    } finally {
      set({ saving: false })
    }
  },
  async diagnose(alert) {
    set({ diagnosingId: alert.id, diagnosis: null })
    const result = await diagnoseAlert(alert.id)
    set({ diagnosingId: null, diagnosis: result })
  },
  async acknowledge(alertId) {
    const updated = await acknowledgeAlert(alertId)
    set({ alerts: replaceAlert(get().alerts, updated), selectedAlert: get().selectedAlert?.id === updated.id ? updated : get().selectedAlert })
    await get().loadSummary()
  },
  async resolve(alertId) {
    const updated = await resolveAlert(alertId)
    set({ alerts: replaceAlert(get().alerts, updated), selectedAlert: get().selectedAlert?.id === updated.id ? updated : get().selectedAlert })
    await get().loadSummary()
  },
  async suppressFingerprint(input) {
    await suppressAlertFingerprint(input)
    await Promise.all([get().load(), get().refreshOverview(), get().loadSuppressedAlerts()])
  },
  async unsuppressFingerprint(fingerprint) {
    await unsuppressAlertFingerprint(fingerprint)
    await Promise.all([get().load(), get().refreshOverview(), get().loadSuppressedAlerts()])
  },
}))
