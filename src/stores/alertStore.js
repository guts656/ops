import { create } from 'zustand'
import { acknowledgeAlert, createAlert, diagnoseAlert, getAlertNoiseStats, getAlertSummary, listSuppressedAlerts, queryAlerts, resolveAlert, suppressAlertFingerprint, unsuppressAlertFingerprint } from '../api/alerts'

function replaceAlert(alerts, updated) {
  return alerts.map((alert) => (alert.id === updated.id ? updated : alert))
}

const defaultFilters = { includeSuppressed: false }
const defaultPagination = { page: 1, pageSize: 20, total: 0 }

function splitPagination(input = {}) {
  const { page, pageSize, total, ...filters } = input
  return { filters, page, pageSize, total }
}

export const useAlertStore = create((set, get) => ({
  alerts: [],
  filters: defaultFilters,
  pagination: defaultPagination,
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
    const { filters: nextFilters } = splitPagination(filters)
    set({ filters: { ...get().filters, ...nextFilters }, pagination: { ...get().pagination, page: 1 } })
  },
  openDetail(alert) {
    set({ selectedAlert: alert, detailOpen: true })
  },
  closeDetail() {
    set({ selectedAlert: null, detailOpen: false })
  },
  async load(filters = get().filters) {
    const { filters: filterInput, page, pageSize } = splitPagination(filters)
    const currentPagination = get().pagination
    const nextFilters = { ...get().filters, ...filterInput }
    const nextPagination = {
      ...currentPagination,
      page: page ?? currentPagination.page,
      pageSize: pageSize ?? currentPagination.pageSize,
    }
    set({ loading: true, filters: nextFilters, pagination: nextPagination })
    try {
      const result = await queryAlerts({ ...nextFilters, page: nextPagination.page, pageSize: nextPagination.pageSize })
      set({ alerts: result.data, pagination: { page: result.page, pageSize: result.pageSize, total: result.total } })
    } finally {
      set({ loading: false })
    }
  },
  async changePage(page, pageSize) {
    await get().load({ page, pageSize })
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
