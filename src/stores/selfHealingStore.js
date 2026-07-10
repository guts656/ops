import { create } from 'zustand'
import { buildSelfHealingLogExport, copySelfHealingRule, createSelfHealingRule, deleteSelfHealingRule, evaluateSelfHealingRule, getSelfHealingHistory, getSelfHealingRules, setSelfHealingRuleEnabled, updateSelfHealingRule } from '../api/selfHealing'

function replaceRule(rules, updated) {
  return rules.map((rule) => (rule.id === updated.id ? updated : rule))
}

export const useSelfHealingStore = create((set, get) => ({
  rules: [],
  history: [],
  loading: false,
  saving: false,
  drawerOpen: false,
  editingRule: null,
  historyRuleId: undefined,
  async load() {
    set({ loading: true })
    try {
      const [rules, history] = await Promise.all([getSelfHealingRules(), getSelfHealingHistory()])
      set({ rules, history })
    } finally {
      set({ loading: false })
    }
  },
  openCreate() {
    set({ drawerOpen: true, editingRule: null })
  },
  openEdit(rule) {
    set({ drawerOpen: true, editingRule: rule })
  },
  closeDrawer() {
    set({ drawerOpen: false, editingRule: null })
  },
  async saveRule(values) {
    const current = get().editingRule
    set({ saving: true })
    try {
      const rule = current ? await updateSelfHealingRule(current.id, values) : await createSelfHealingRule(values)
      set((state) => ({
        rules: current ? replaceRule(state.rules, rule) : [rule, ...state.rules],
        drawerOpen: false,
        editingRule: null,
      }))
    } finally {
      set({ saving: false })
    }
  },
  async toggleRule(ruleId, enabled) {
    const rule = await setSelfHealingRuleEnabled(ruleId, enabled)
    set((state) => ({ rules: replaceRule(state.rules, rule) }))
  },
  async deleteRule(ruleId) {
    await deleteSelfHealingRule(ruleId)
    set((state) => ({ rules: state.rules.filter((rule) => rule.id !== ruleId) }))
  },
  async copyRule(rule) {
    const copied = await copySelfHealingRule(rule.id)
    set((state) => ({ rules: [copied, ...state.rules] }))
  },
  async evaluateRule(ruleId) {
    const execution = await evaluateSelfHealingRule(ruleId)
    const [rules, history] = await Promise.all([getSelfHealingRules(), getSelfHealingHistory()])
    set({ rules, history })
    return execution
  },
  async filterHistory(ruleId) {
    const history = await getSelfHealingHistory({ ruleId })
    set({ history, historyRuleId: ruleId })
  },
  async exportLogs() {
    const content = buildSelfHealingLogExport(get().history)
    const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = 'self-healing-history.json'
    link.click()
    URL.revokeObjectURL(url)
  },
}))
