import { evaluateDueSslCertificateMonitorsOnce } from '../data/sslCertificateMonitors'

let started = false
let running = false

export function startSslCertificateScheduler() {
  if (started) return
  started = true
  const intervalMs = Math.max(10000, Number(process.env.SSL_CERTIFICATE_SCHEDULER_INTERVAL_MS || 60000))
  const tick = async () => {
    if (running) return
    running = true
    try {
      await evaluateDueSslCertificateMonitorsOnce()
    } catch (error) {
      console.error('SSL certificate scheduler failed', error)
    } finally {
      running = false
    }
  }
  setInterval(tick, intervalMs)
  void tick()
}
