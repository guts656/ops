import { runDueHostPullMetrics } from '../data/hosts.ts'

let started = false
let running = false

export function startHostPullScheduler() {
  if (started) return
  started = true

  async function tick() {
    if (running) return
    running = true
    try {
      await runDueHostPullMetrics()
    } catch (error) {
      console.error('SSH 自动 Pull 指标调度失败', error)
    } finally {
      running = false
    }
  }

  setInterval(() => void tick(), 30000)
  void tick()
}
