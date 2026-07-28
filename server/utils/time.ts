const shanghaiFormatter = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false,
  hourCycle: 'h23',
})

export function shanghaiTime(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-'
  const parts = Object.fromEntries(shanghaiFormatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

export function shanghaiDate(date: Date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '-'
  const parts = Object.fromEntries(shanghaiFormatter.formatToParts(date).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function startOfShanghaiDayUtc(date = new Date()) {
  const parts = Object.fromEntries(shanghaiFormatter.formatToParts(date).map((part) => [part.type, part.value]))
  return new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)) - 8 * 60 * 60 * 1000)
}
