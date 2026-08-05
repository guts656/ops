import { prisma } from '../db/prisma'
import { setHostMaintenance } from '../data/hosts'

const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000
const SATURDAY = 6
const WINDOW_START_HOUR = 7
const WINDOW_END_HOUR = 8
const SCHEDULE_OPERATOR = '系统定时维护'
const SCHEDULE_REASON = '每周六 Windows 计划重启维护（07:00-08:00）'
const DEFAULT_INTERVAL_MS = 60_000

let schedulerTimer: NodeJS.Timeout | undefined
let running = false

function enabled() {
  return process.env.WINDOWS_WEEKLY_MAINTENANCE_ENABLED !== 'false'
}

function shanghaiParts(now: Date) {
  const local = new Date(now.getTime() + SHANGHAI_OFFSET_MS)
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth(),
    day: local.getUTCDate(),
    weekday: local.getUTCDay(),
    hour: local.getUTCHours(),
  }
}

function scheduledWindow(now: Date) {
  const parts = shanghaiParts(now)
  if (parts.weekday !== SATURDAY || parts.hour < WINDOW_START_HOUR || parts.hour >= WINDOW_END_HOUR) return undefined
  return {
    until: new Date(Date.UTC(parts.year, parts.month, parts.day, WINDOW_END_HOUR - 8)),
  }
}

export async function evaluateWindowsWeeklyMaintenance(now = new Date(), options: { hostIds?: string[] } = {}) {
  const hostIds = options.hostIds?.filter(Boolean)
  const idFilter = hostIds?.length ? { in: hostIds } : undefined
  const window = scheduledWindow(now)

  if (!window) {
    const scheduledHosts = await prisma.host.findMany({
      where: { id: idFilter, os: 'Windows', maintenanceEnabled: true, maintenanceOperator: SCHEDULE_OPERATOR },
      select: { id: true },
    })
    for (const host of scheduledHosts) await setHostMaintenance(host.id, { enabled: false }, SCHEDULE_OPERATOR)
    return { activeWindow: false, entered: 0, exited: scheduledHosts.length, skipped: 0 }
  }

  const hosts = await prisma.host.findMany({
    where: { id: idFilter, os: 'Windows' },
    orderBy: { ip: 'asc' },
    select: {
      id: true,
      maintenanceEnabled: true,
      maintenanceUntil: true,
      maintenanceOperator: true,
    },
  })
  let entered = 0
  let skipped = 0

  for (const host of hosts) {
    const active = host.maintenanceEnabled && (!host.maintenanceUntil || host.maintenanceUntil > now)
    if (active) {
      skipped += 1
      continue
    }
    await setHostMaintenance(host.id, { enabled: true, reason: SCHEDULE_REASON, until: window.until.toISOString() }, SCHEDULE_OPERATOR)
    entered += 1
  }

  return { activeWindow: true, entered, exited: 0, skipped, until: window.until.toISOString() }
}

export function startWindowsWeeklyMaintenanceScheduler() {
  if (!enabled() || schedulerTimer) return schedulerTimer
  const intervalMs = Math.max(10_000, Number(process.env.WINDOWS_WEEKLY_MAINTENANCE_INTERVAL_MS || DEFAULT_INTERVAL_MS))
  const tick = async () => {
    if (running) return
    running = true
    try {
      const result = await evaluateWindowsWeeklyMaintenance()
      if (result.entered || result.exited) console.log('Windows weekly maintenance:', result)
    } catch (error) {
      console.error('Windows weekly maintenance scheduler failed:', error)
    } finally {
      running = false
    }
  }
  schedulerTimer = setInterval(() => void tick(), intervalMs)
  schedulerTimer.unref?.()
  void tick()
  return schedulerTimer
}
