import { runDueWeeklyHealthReport } from '../data/healthReports'

let started = false
let running = false

export async function runHealthReportSchedulerOnce() {
  return runDueWeeklyHealthReport()
}

export function startHealthReportScheduler() {
  if (started) return
  started = true
  const intervalMs = Math.max(60_000, Number(process.env.HEALTH_REPORT_SCHEDULER_INTERVAL_MS || 60 * 60 * 1000))

  async function tick() {
    if (running) return
    running = true
    try {
      await runHealthReportSchedulerOnce()
    } catch (error) {
      console.error('每周系统健康报告生成调度失败', error)
    } finally {
      running = false
    }
  }

  setInterval(() => void tick(), intervalMs)
  void tick()
}
