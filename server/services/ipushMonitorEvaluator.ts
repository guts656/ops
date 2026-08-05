import { evaluateIpushMonitorRulesOnce } from '../data/ipushMonitorRules'

let started = false
let running = false

export function startIpushMonitorEvaluator() {
  if (started) return
  started = true
  const intervalMs = Number(process.env.IPUSH_MONITOR_EVALUATOR_INTERVAL_MS || 30000)
  const tick = async () => {
    if (running) return
    running = true
    try {
      await evaluateIpushMonitorRulesOnce()
    } catch (error) {
      console.error('iPush monitor evaluator failed', error)
    } finally {
      running = false
    }
  }
  setInterval(tick, intervalMs)
  void tick()
}
