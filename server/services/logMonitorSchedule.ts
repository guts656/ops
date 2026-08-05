import type { LogMonitorRule } from '../types/log'

type LogMonitorSchedule = Pick<LogMonitorRule, 'daysOfWeek' | 'timeRanges' | 'holidayMode' | 'holidays'>

const weekdayMap = [7, 1, 2, 3, 4, 5, 6]
const formatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
  hourCycle: 'h23',
})

export function shanghaiScheduleParts(date: Date) {
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))
  const dateText = `${parts.year}-${parts.month}-${parts.day}`
  const localCalendarDay = new Date(`${dateText}T00:00:00Z`).getUTCDay()
  return {
    date: dateText,
    time: `${parts.hour}:${parts.minute}`,
    weekday: weekdayMap[localCalendarDay],
  }
}

function previousWeekday(weekday: number) {
  return weekday === 1 ? 7 : weekday - 1
}

function weekdayMatches(schedule: LogMonitorSchedule, weekday: number, rangeIndex?: number) {
  const range = rangeIndex === undefined ? undefined : schedule.timeRanges[rangeIndex]
  if (range?.daysOfWeek?.length) return range.daysOfWeek.includes(weekday)
  if (!schedule.daysOfWeek.length) return true
  const effectiveWeekday = range?.dayOffset === 1 ? previousWeekday(weekday) : weekday
  return schedule.daysOfWeek.includes(effectiveWeekday)
}

export function isLogMonitorScheduleActive(schedule: LogMonitorSchedule, date = new Date()) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return false
  const current = shanghaiScheduleParts(date)
  const holidayMatched = schedule.holidays.includes(current.date)
  if (schedule.holidayMode === 'include' && !holidayMatched) return false
  if (schedule.holidayMode === 'exclude' && holidayMatched) return false

  if (!schedule.timeRanges.length) return weekdayMatches(schedule, current.weekday)
  return schedule.timeRanges.some((range, index) => (
    current.time >= range.start
    && current.time <= range.end
    && weekdayMatches(schedule, current.weekday, index)
  ))
}
