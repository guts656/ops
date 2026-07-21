export type HostMarketType = 'CN_INTERNAL' | 'GLOBAL_EXTERNAL' | 'ALWAYS_ON'

export interface TradingTimeRange {
  start: string
  end: string
}

export interface TradingMarketSession {
  key: HostMarketType
  label: string
  weekdays: number[]
  sessions: TradingTimeRange[]
}

export interface DashboardTradingSessionSettings {
  timezone: string
  windowDays: number
  markets: TradingMarketSession[]
}

const weekdayTextMap: Record<string, number> = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
const allowedMarketTypes = new Set<HostMarketType>(['CN_INTERNAL', 'GLOBAL_EXTERNAL', 'ALWAYS_ON'])

export const defaultDashboardTradingSessionSettings: DashboardTradingSessionSettings = {
  timezone: 'Asia/Shanghai',
  windowDays: 7,
  markets: [
    { key: 'CN_INTERNAL', label: '内盘', weekdays: [1, 2, 3, 4, 5], sessions: [{ start: '09:30', end: '11:30' }, { start: '13:00', end: '15:00' }] },
    { key: 'GLOBAL_EXTERNAL', label: '外盘', weekdays: [1, 2, 3, 4, 5], sessions: [{ start: '21:00', end: '02:30' }] },
    { key: 'ALWAYS_ON', label: '全天', weekdays: [1, 2, 3, 4, 5, 6, 7], sessions: [{ start: '00:00', end: '23:59' }] },
  ],
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function validTime(value: string) {
  if (!/^\d{2}:\d{2}$/.test(value)) return false
  const [hour, minute] = value.split(':').map(Number)
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59
}

function minuteOfDay(value: string) {
  const [hour, minute] = value.split(':').map(Number)
  return hour * 60 + minute
}

function normalizeWeekdays(values: unknown, fallback: number[]) {
  if (!Array.isArray(values)) return fallback
  const days = Array.from(new Set(values.map(Number).filter((day) => Number.isInteger(day) && day >= 1 && day <= 7))).sort((a, b) => a - b)
  return days.length ? days : fallback
}

function normalizeSessions(values: unknown, fallback: TradingTimeRange[]) {
  if (!Array.isArray(values)) return fallback
  const sessions = values.map((item) => {
    const raw = item && typeof item === 'object' && !Array.isArray(item) ? item as Partial<TradingTimeRange> : {}
    return { start: text(raw.start), end: text(raw.end) }
  }).filter((range) => validTime(range.start) && validTime(range.end)).slice(0, 8)
  return sessions.length ? sessions : fallback
}

export function normalizeMarketType(value: unknown): HostMarketType {
  return allowedMarketTypes.has(value as HostMarketType) ? value as HostMarketType : 'CN_INTERNAL'
}

export function normalizeDashboardTradingSessionSettings(value: unknown): DashboardTradingSessionSettings {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Partial<DashboardTradingSessionSettings> : {}
  const defaultsByKey = new Map(defaultDashboardTradingSessionSettings.markets.map((market) => [market.key, market]))
  const rawMarkets = Array.isArray(raw.markets) ? raw.markets : []
  const rawByKey = new Map(rawMarkets.map((market) => [normalizeMarketType((market as Partial<TradingMarketSession>).key), market as Partial<TradingMarketSession>]))
  const markets = defaultDashboardTradingSessionSettings.markets.map((fallback) => {
    const rawMarket = rawByKey.get(fallback.key) ?? defaultsByKey.get(fallback.key)!
    return {
      key: fallback.key,
      label: text(rawMarket.label) || fallback.label,
      weekdays: normalizeWeekdays(rawMarket.weekdays, fallback.weekdays),
      sessions: normalizeSessions(rawMarket.sessions, fallback.sessions),
    }
  })
  const windowDays = Math.min(30, Math.max(1, Math.floor(Number(raw.windowDays || defaultDashboardTradingSessionSettings.windowDays))))
  return { timezone: text(raw.timezone) || defaultDashboardTradingSessionSettings.timezone, windowDays, markets }
}

function localDateParts(date: Date, timezone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date)
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  const weekdayText = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(date)
  const hour = values.hour === '24' ? '00' : values.hour
  return { time: `${hour}:${values.minute}`, weekday: weekdayTextMap[weekdayText] ?? 7 }
}

function previousWeekday(day: number) {
  return day === 1 ? 7 : day - 1
}

function inSession(minute: number, weekday: number, weekdays: number[], range: TradingTimeRange) {
  const start = minuteOfDay(range.start)
  const end = minuteOfDay(range.end)
  if (start <= end) return weekdays.includes(weekday) && minute >= start && minute <= end
  if (minute >= start) return weekdays.includes(weekday)
  if (minute <= end) return weekdays.includes(previousWeekday(weekday))
  return false
}

export function isTradingTime(date: Date, marketType: string | null | undefined, settings: DashboardTradingSessionSettings) {
  const config = normalizeDashboardTradingSessionSettings(settings)
  const type = normalizeMarketType(marketType)
  if (type === 'ALWAYS_ON') return true
  const market = config.markets.find((item) => item.key === type) ?? config.markets[0]
  const current = localDateParts(date, config.timezone)
  const minute = minuteOfDay(current.time)
  return market.sessions.some((range) => inSession(minute, current.weekday, market.weekdays, range))
}
