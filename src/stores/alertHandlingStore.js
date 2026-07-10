import { create } from 'zustand'
import { createAlertHandlingRule, deleteAlertHandlingRule, listAlertHandlingRules, updateAlertHandlingRule } from '../api/alertHandlingRules'
import { getSelfHealingRules } from '../api/selfHealing'

function replaceRule(rules, updated) {
  return rules.map((rule) => (rule.id === updated.id ? updated : rule))
}

export const useAlertHandlingStore = create((set, get) => ({
  rules: [],
  selfHealingRules: [],
  loading: false,
  saving: false,
  async load() {
    set({ loading: true })
    try {
      const [rules, selfHealingRules] = await Promise.all([listAlertHandlingRules(), getSelfHealingRules()])
      set({ rules, selfHealingRules })
    } finally {
      set({ loading: false })
    }
  },
  async save(input, id) {
    set({ saving: true })
    try {
      const rule = id ? await updateAlertHandlingRule(id, input) : await createAlertHandlingRule(input)
      set((state) => ({ rules: id ? replaceRule(state.rules, rule) : [rule, ...state.rules] }))
      return rule
    } finally {
      set({ saving: false })
    }
  },
  async remove(id) {
    await deleteAlertHandlingRule(id)
    set((state) => ({ rules: state.rules.filter((rule) => rule.id !== id) }))
  },
  async toggle(rule) {
    await get().save({ ...rule, enabled: !rule.enabled }, rule.id)
  },
}))
