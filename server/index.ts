import { createServer } from 'node:http'
import cors from 'cors'
import dotenv from 'dotenv'
import express from 'express'
import authRouter from './routes/auth.ts'
import accountsRouter from './routes/accounts.ts'
import alertsRouter from './routes/alerts.ts'
import cgiMonitorsRouter from './routes/cgiMonitors.ts'
import hostResourceMonitorsRouter from './routes/hostResourceMonitors.ts'
import healthReportsRouter from './routes/healthReports.ts'
import webhooksRouter from './routes/webhooks.ts'
import notificationsRouter from './routes/notifications.ts'
import settingsRouter from './routes/settings.ts'
import alertHandlingRulesRouter from './routes/alertHandlingRules.ts'
import agentMetricsRouter from './routes/agentMetrics.ts'
import hostsRouter from './routes/hosts.ts'
import logsRouter from './routes/logs.ts'
import dashboardRouter from './routes/dashboard.ts'
import auditLogsRouter from './routes/auditLogs.ts'
import selfHealingRouter from './routes/selfHealing.ts'
import batchJobsRouter from './routes/batchJobs.ts'
import { corsOrigin, isProduction, validateSecurityEnv } from './config/env.ts'
import { prisma } from './db/prisma.ts'
import { errorHandler } from './middleware/errorHandler.ts'
import { traceMiddleware } from './middleware/trace.ts'
import { startHostPullScheduler } from './services/hostPullScheduler.ts'
import { startCgiMonitorEvaluator } from './services/cgiMonitorEvaluator.ts'
import { startLogMonitorEvaluator } from './services/logMonitorEvaluator.ts'
import { startLogRetentionScheduler } from './services/logRetentionScheduler.ts'
import { startHealthReportScheduler } from './services/healthReportScheduler.ts'
import { startSelfHealingEvaluator } from './services/selfHealingEvaluator.ts'
import { startHostOfflineWatchdog } from './services/hostOfflineWatchdog.ts'
import { startAgentLogUploadWatchdog } from './services/agentLogUploadWatchdog.ts'
import { setupRealtime } from './services/realtime.ts'
import { cleanupLinuxServiceMonitoring } from './data/hostServices.ts'

dotenv.config()
validateSecurityEnv()
console.log('Windows Agent installer script:', { newAgent: true, heartbeat: false })

const app = express()
const server = createServer(app)
const port = Number(process.env.PORT || 3001)

app.use(cors({ origin: corsOrigin }))
app.use(express.json({ limit: '8mb' }))
app.use(traceMiddleware)

app.get('/health/live', (_req, res) => {
  res.json({ status: 'alive', timestamp: new Date().toISOString() })
})

app.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`
    res.json({ ready: true, status: 'healthy', checks: { database: 'ok' }, timestamp: new Date().toISOString() })
  } catch (error) {
    console.error('Database readiness check failed:', error)
    res.status(503).json({
      ready: false,
      status: 'unhealthy',
      checks: { database: 'failed' },
      ...(isProduction ? {} : { message: error instanceof Error ? error.message : String(error) }),
      timestamp: new Date().toISOString(),
    })
  }
})

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, status: 'healthy', timestamp: new Date().toISOString() })
})

app.use('/api/webhooks', webhooksRouter)
app.use('/api/auth', authRouter)
app.use('/api/accounts', accountsRouter)
app.use('/api/alerts', alertsRouter)
app.use('/api/cgi-monitors', cgiMonitorsRouter)
app.use('/api/host-resource-monitors', hostResourceMonitorsRouter)
app.use('/api/health-reports', healthReportsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/alert-handling-rules', alertHandlingRulesRouter)
app.use('/api/agent', agentMetricsRouter)
app.use('/api/hosts', hostsRouter)
app.use('/api/logs', logsRouter)
app.use('/api/dashboard', dashboardRouter)
app.use('/api/audit/logs', auditLogsRouter)
app.use('/api/self-healing', selfHealingRouter)
app.use('/api/batch-jobs', batchJobsRouter)
app.use(errorHandler)

setupRealtime(server)

server.listen(port, () => {
  startHostPullScheduler()
  startSelfHealingEvaluator()
  startLogMonitorEvaluator()
  startLogRetentionScheduler()
  startHealthReportScheduler()
  startCgiMonitorEvaluator()
  startHostOfflineWatchdog()
  startAgentLogUploadWatchdog()
  cleanupLinuxServiceMonitoring()
    .then((result) => {
      if (result.services || result.events || result.alertsResolved) console.log('Linux service monitoring cleanup:', result)
    })
    .catch((error) => console.error('Linux service monitoring cleanup failed:', error))
  console.log(`API server listening on http://localhost:${port}`)
})
