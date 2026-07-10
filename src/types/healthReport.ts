export type HealthLevel = 'excellent' | 'good' | 'warning' | 'critical'
export type ReportSeverity = 'success' | 'info' | 'warning' | 'error'

export interface HealthCause {
  key: string
  title: string
  severity: 'warning' | 'error'
  evidence: string[]
  relatedType?: string
  relatedId?: string
}

export interface HealthReportSection {
  key: string
  title: string
  severity: ReportSeverity
  summary: string
  bullets: string[]
  metrics?: Array<{ label: string; value: string | number; severity?: ReportSeverity }>
}

export interface OptimizationSuggestion {
  key: string
  title: string
  priority: 'high' | 'medium' | 'low'
  category: string
  rationale: string
  actions: string[]
}

export interface HealthReport {
  id: string
  type: 'weekly'
  periodStart: string
  periodEnd: string
  title: string
  status: string
  healthScore: number
  healthLevel: HealthLevel
  summary: string
  causes: HealthCause[]
  alertSummary: Record<string, unknown>
  sections: HealthReportSection[]
  suggestions: OptimizationSuggestion[]
  sourceSnapshot: Record<string, unknown>
  generatedBy: string
  generatedAt: string
  createdAt: string
  updatedAt: string
}

export interface HealthReportListResult {
  items: HealthReport[]
  total: number
  page: number
  pageSize: number
}
