export function formatShanghaiTime(value?: string | number | Date | null) {
  if (!value) return '-'
  if (typeof value === 'string' && /^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}/.test(value)) return value.replace(/\//g, '-')
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
}
