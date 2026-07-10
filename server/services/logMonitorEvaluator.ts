import { ensureDefaultErrorLogMonitorRule, evaluateLogMonitorRulesOnce } from '../data/logMonitorRules'

let started = false
let running = false

export async function runLogMonitorEvaluatorOnce() {
  return evaluateLogMonitorRulesOnce()
}

export function startLogMonitorEvaluator() {
  if (started) return
  started = true
  const intervalMs = Math.max(5000, Number(process.env.LOG_MONITOR_EVALUATOR_INTERVAL_MS || 30000))

  async function tick() {
    if (running) return
    running = true
    try {
      await ensureDefaultErrorLogMonitorRule()
      await runLogMonitorEvaluatorOnce()
    } catch (error) {
      console.error('日志监控规则评估调度失败', error)
    } finally {
      running = false
    }
  }

  setInterval(() => void tick(), intervalMs)
  void tick()
}
