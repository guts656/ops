import { cleanupOldAppLogs } from '../data/logs'

let started = false
let running = false

export async function runLogRetentionCleanupOnce() {
  return cleanupOldAppLogs()
}

export function startLogRetentionScheduler() {
  if (started) return
  started = true
  const intervalMs = Math.max(60_000, Number(process.env.LOG_RETENTION_CLEANUP_INTERVAL_MS || 60 * 60 * 1000))

  async function tick() {
    if (running) return
    running = true
    try {
      const result = await runLogRetentionCleanupOnce()
      if (result.count > 0) console.log(`已清理超过保留期日志 ${result.count} 条`)
    } catch (error) {
      console.error('日志保留清理任务失败', error)
    } finally {
      running = false
    }
  }

  setInterval(() => void tick(), intervalMs)
  void tick()
}
