import type { LogMonitorRuleInput, LogMonitorTimeRange } from '../types/log'

export interface Xm2SkippedItem {
  legacyIndex: number
  legacyKey?: string
  legacyName?: string
  type?: string
  mode?: string
  source?: string
  word?: string
  reason: string
}

export interface Xm2ConvertedRulePreview {
  key: string
  legacyIndex: number
  legacyKey?: string
  legacyName?: string
  sourceFile: string
  rule: LogMonitorRuleInput
  warnings: string[]
}

export interface Xm2ConvertPreviewResult {
  summary: {
    total: number
    convertible: number
    skipped: number
    invalid: number
  }
  candidates: Xm2ConvertedRulePreview[]
  skipped: Xm2SkippedItem[]
}

type LegacyMonitorItem = {
  key?: unknown
  type?: unknown
  hhmm?: unknown
  interval?: unknown
  more?: Record<string, unknown>
}

const MAX_NAME_LENGTH = 80
const MAX_DESCRIPTION_LENGTH = 300
const MAX_KEYWORD_LENGTH = 120

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function rootItems(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const record = asRecord(value)
  if (!record) throw new Error('xm2 JSON 必须是数组，或包含 data/rules/items 数组')
  for (const key of ['data', 'rules', 'items', 'monitors']) {
    const items = record[key]
    if (Array.isArray(items)) return items
  }
  throw new Error('xm2 JSON 必须是数组，或包含 data/rules/items 数组')
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : value == null ? '' : String(value).trim()
}

function legacyName(item: LegacyMonitorItem, file = '', word = '') {
  const more = item.more ?? {}
  return text(more.name) || text(more.describe) || text(item.key) || [fileName(file), word].filter(Boolean).join(' ')
}

function fileName(path: string) {
  const name = path.replaceAll('\\', '/').split('/').filter(Boolean).pop() || 'xm2-log'
  return name
    .replace(/_%Y%m%d/gi, '')
    .replace(/%Y%m%d/gi, '')
    .replace(/_%Y%m/gi, '')
    .replace(/%Y%m/gi, '')
    .replace(/\.(log|txt|out|err)$/i, '') || 'xm2-log'
}

function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max) : value
}

function threshold(value: unknown) {
  const parsed = Number(text(value) || 1)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.floor(parsed)
}

function windowMinutes(value: unknown) {
  const parsed = Number(text(value) || 60)
  if (!Number.isFinite(parsed) || parsed < 1) return 1
  return Math.max(1, Math.ceil(parsed / 60))
}

function normalizeTime(value: string) {
  const clean = value.trim().replace(':', '')
  if (!/^\d{4}$/.test(clean)) return undefined
  const hour = Number(clean.slice(0, 2))
  const minute = Number(clean.slice(2, 4))
  if (clean === '2400') return '23:59'
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return undefined
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
}

function parseHhmm(value: unknown) {
  const raw = text(value)
  const warnings: string[] = []
  if (!raw || raw === '0000-2400') return { ranges: [] as LogMonitorTimeRange[], warnings }

  const ranges: LogMonitorTimeRange[] = []
  for (const part of raw.split(';').map((item) => item.trim()).filter(Boolean)) {
    const [startRaw, endRaw] = part.split('-').map((item) => item?.trim())
    const start = normalizeTime(startRaw || '')
    const end = normalizeTime(endRaw || '')
    if (!start || !end) {
      warnings.push(`时间段 ${part} 格式无效，已跳过`)
      continue
    }
    if (start < end) {
      ranges.push({ start, end })
    } else if (start > end) {
      ranges.push({ start, end: '23:59' })
      if (end !== '00:00') ranges.push({ start: '00:00', end, dayOffset: 1 })
    } else {
      warnings.push(`时间段 ${part} 起止相同，已跳过`)
    }
  }

  const deduped: LogMonitorTimeRange[] = []
  const seen = new Set<string>()
  for (const range of ranges) {
    const key = `${range.start}-${range.end}-${range.dayOffset ?? 0}`
    if (seen.has(key)) continue
    seen.add(key)
    deduped.push(range)
  }
  if (deduped.length > 8) warnings.push('时间段超过 8 个，仅保留前 8 个')
  return { ranges: deduped.slice(0, 8), warnings }
}

function description(item: LegacyMonitorItem) {
  const more = item.more ?? {}
  const parts: string[] = []
  const handle = text(more.handle)
  const describe = text(more.describe)
  if (describe) parts.push(describe)
  if (handle) parts.push(`处理建议：${handle}`)
  return truncate(parts.join('\n'), MAX_DESCRIPTION_LENGTH)
}

export function convertXm2MonitorJson(input: unknown): Xm2ConvertPreviewResult {
  const items = rootItems(input)
  const candidates: Xm2ConvertedRulePreview[] = []
  const skipped: Xm2SkippedItem[] = []

  items.forEach((raw, index) => {
    const item = asRecord(raw) as LegacyMonitorItem | undefined
    if (!item) {
      skipped.push({ legacyIndex: index, reason: '规则不是有效对象，已跳过' })
      return
    }

    const more = asRecord(item.more) ?? {}
    item.more = more
    const type = text(item.type)
    const mode = text(more.mode) || 'include'
    const file = text(more.file || more.path)
    const word = truncate(text(more.word), MAX_KEYWORD_LENGTH)
    const key = text(item.key) || `xm2-${index}`
    const name = legacyName(item, file, word)
    const skippedBase = { legacyIndex: index, legacyKey: key, legacyName: name, type, mode, source: file, word }

    if (type !== 'fileContent') {
      skipped.push({ ...skippedBase, reason: '非日志内容监控，已跳过' })
      return
    }
    if (mode !== 'include') {
      skipped.push({ ...skippedBase, reason: mode === 'exclude' ? 'exclude 排除模式暂不支持自动等价转换' : `不支持的匹配模式：${mode}` })
      return
    }
    if (!file) {
      skipped.push({ ...skippedBase, reason: '缺少日志文件路径' })
      return
    }
    if (!word) {
      skipped.push({ ...skippedBase, reason: '缺少包含关键字' })
      return
    }

    const time = parseHhmm(item.hhmm)
    const ruleName = truncate(`${fileName(file)} ${word}`, MAX_NAME_LENGTH)
    candidates.push({
      key: `${key}-${index}`,
      legacyIndex: index,
      legacyKey: key,
      legacyName: name,
      sourceFile: file,
      warnings: time.warnings,
      rule: {
        name: ruleName || `xm2-${index}`,
        description: description(item),
        enabled: false,
        source: file,
        keywords: [word],
        threshold: threshold(more.diffcount),
        windowMinutes: windowMinutes(item.interval),
        cooldownMinutes: 3,
        alertLevel: '警告',
        hostScope: 'all',
        hostIds: [],
        timeRanges: time.ranges,
        daysOfWeek: [],
        holidayMode: 'ignore',
        holidays: [],
        notification: {},
      },
    })
  })

  return {
    summary: {
      total: items.length,
      convertible: candidates.length,
      skipped: skipped.length,
      invalid: 0,
    },
    candidates,
    skipped,
  }
}
