import { evaluateCgiMonitorRulesOnce } from '../data/cgiMonitorRules'

let started = false
let running = false

export function startCgiMonitorEvaluator() {
  if (started) return
  started = true
  const intervalMs = Number(process.env.CGI_MONITOR_EVALUATOR_INTERVAL_MS || 30000)
  const tick = async () => {
    if (running) return
    running = true
    try {
      await evaluateCgiMonitorRulesOnce()
    } catch (error) {
      console.error('CGI monitor evaluator failed', error)
    } finally {
      running = false
    }
  }
  setInterval(tick, intervalMs)
  void tick()
}
