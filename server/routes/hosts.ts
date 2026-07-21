import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions.ts'
import { getHostContainers } from '../data/hostContainers.ts'
import { deleteLogCollectionRule, getLogCollectionRules, saveLogCollectionRule } from '../data/logCollectionRules.ts'
import { addHosts, deleteHost, deleteHostServiceRecord, diagnoseAgentBackend, disableHostPullCredential, getHost, getHostAgentJobs, getHostAuditLogs, getHostOptions, getHostResourceTrend, pullHostMetrics, queryHosts, refreshHostInfo, remanageHost, reinstallAgent, repairAgentBackendRoutes, restartAgent, saveHostPullCredential, setHostMaintenance, startHostService, stopHostService, testHostConnection, updateHost } from '../data/hosts.ts'
import { getHostServiceEvents, getHostServices } from '../data/hostServices.ts'
import { authenticate } from '../middleware/authenticate.ts'
import { requirePermission } from '../middleware/requirePermission.ts'
import type { AuthRequest } from '../types/auth'

function paramId(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

const hostFiltersSchema = z.object({
  keyword: z.string().optional(),
  status: z.enum(['在线', '离线', '纳管中']).optional(),
  tag: z.string().optional(),
  group: z.string().optional(),
})

const hostMarketTypeSchema = z.enum(['CN_INTERNAL', 'GLOBAL_EXTERNAL', 'ALWAYS_ON'])

const addHostSchema = z.object({
  ips: z.string().min(1),
  hostname: z.string().optional(),
  os: z.enum(['Linux', 'Windows']).optional(),
  osVersion: z.string().optional(),
  sshUsername: z.string().min(1),
  authType: z.enum(['密码', '密钥']),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  sshPort: z.coerce.number().min(1).max(65535),
  group: z.string().min(1),
  marketType: hostMarketTypeSchema.optional(),
  tags: z.array(z.string()).optional(),
  changeNo: z.string().optional(),
})

const editHostSchema = z.object({
  hostname: z.string().min(1),
  os: z.enum(['Linux', 'Windows']),
  osVersion: z.string().min(1),
  sshPort: z.coerce.number().min(1).max(65535),
  group: z.string().min(1),
  marketType: hostMarketTypeSchema.default('CN_INTERNAL'),
  tags: z.array(z.string()).default([]),
})
const testConnectionSchema = addHostSchema.partial().extend({ ips: z.string().optional() })
const agentCredentialsSchema = z.object({
  sshUsername: z.string().min(1),
  authType: z.enum(['密码', '密钥']),
  password: z.string().optional(),
  privateKey: z.string().optional(),
  sshPort: z.coerce.number().min(1).max(65535),
})
const reinstallAgentSchema = agentCredentialsSchema.extend({
  apiBaseUrl: z.string().url().optional(),
})
const maintenanceSchema = z.object({
  enabled: z.boolean(),
  reason: z.string().trim().optional(),
  until: z.string().datetime().optional().or(z.literal('')),
})
const logCollectionRuleSchema = z.object({
  scope: z.enum(['host', 'group']),
  hostId: z.string().optional(),
  hostGroup: z.string().optional(),
  paths: z.array(z.string().min(1)).min(1).max(20),
  enabled: z.boolean().optional(),
})
const router = Router()

router.use(authenticate)

router.get('/', requirePermission(PERMISSIONS.HOSTS_VIEW), async (req, res, next) => {
  try {
    const filters = hostFiltersSchema.parse(req.query)
    res.json({ data: await queryHosts(filters) })
  } catch (error) {
    next(error)
  }
})

router.get('/options', requirePermission(PERMISSIONS.HOSTS_VIEW), async (_req, res, next) => {
  try {
    res.json(await getHostOptions())
  } catch (error) {
    next(error)
  }
})

router.get('/audit-logs', requirePermission(PERMISSIONS.HOSTS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getHostAuditLogs() })
  } catch (error) {
    next(error)
  }
})

router.get('/log-collection-rules', requirePermission(PERMISSIONS.HOSTS_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await getLogCollectionRules() })
  } catch (error) {
    next(error)
  }
})

router.post('/log-collection-rules', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await saveLogCollectionRule(logCollectionRuleSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.delete('/log-collection-rules/:id', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req, res, next) => {
  try {
    await deleteLogCollectionRule(req.params.id)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/resource-trend', requirePermission(PERMISSIONS.HOSTS_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await getHostResourceTrend(paramId(req.params.id)) })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/agent-jobs', requirePermission(PERMISSIONS.HOSTS_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await getHostAgentJobs(paramId(req.params.id)) })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/services', requirePermission(PERMISSIONS.HOSTS_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await getHostServices(paramId(req.params.id)) })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/containers', requirePermission(PERMISSIONS.HOSTS_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await getHostContainers(paramId(req.params.id)) })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/service-events', requirePermission(PERMISSIONS.HOSTS_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await getHostServiceEvents(paramId(req.params.id), Number(req.query.limit || 50)) })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/services/:serviceId/start', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const credentials = agentCredentialsSchema.parse(req.body)
    const updated = await startHostService(paramId(req.params.id), paramId(req.params.serviceId), credentials, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/services/:serviceId/stop', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const credentials = agentCredentialsSchema.parse(req.body)
    const updated = await stopHostService(paramId(req.params.id), paramId(req.params.serviceId), credentials, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id/services/:serviceId', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const updated = await deleteHostServiceRecord(paramId(req.params.id), paramId(req.params.serviceId), req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', requirePermission(PERMISSIONS.HOSTS_VIEW), async (req, res, next) => {
  try {
    const host = await getHost(paramId(req.params.id))
    if (!host) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: host })
  } catch (error) {
    next(error)
  }
})

router.post('/test-connection', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const values = testConnectionSchema.parse(req.body)
    res.json(await testHostConnection(values, req.user!.displayName))
  } catch (error) {
    next(error)
  }
})

router.post('/', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const values = addHostSchema.parse(req.body)
    res.json({ data: await addHosts(values, req.user!.displayName) })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const values = editHostSchema.parse(req.body)
    const updated = await updateHost(paramId(req.params.id), values, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.patch('/:id/maintenance', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const values = maintenanceSchema.parse(req.body)
    const updated = await setHostMaintenance(paramId(req.params.id), { ...values, until: values.until || undefined }, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id', requirePermission(PERMISSIONS.HOSTS_DELETE), async (req: AuthRequest, res, next) => {
  try {
    const deleted = await deleteHost(paramId(req.params.id), req.user!.displayName)
    if (!deleted) return res.status(404).json({ message: '主机不存在' })
    res.json({ success: true, id: deleted.id })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/remanage', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const updated = await remanageHost(paramId(req.params.id), req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/refresh-info', requirePermission(PERMISSIONS.HOSTS_MANAGE), async (req: AuthRequest, res, next) => {
  try {
    const credentials = agentCredentialsSchema.parse(req.body)
    const updated = await refreshHostInfo(paramId(req.params.id), credentials, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/pull-metrics', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const credentials = agentCredentialsSchema.parse(req.body)
    const updated = await pullHostMetrics(paramId(req.params.id), credentials, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/pull-credential', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const credentials = agentCredentialsSchema.parse(req.body)
    const updated = await saveHostPullCredential(paramId(req.params.id), credentials, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.delete('/:id/pull-credential', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const updated = await disableHostPullCredential(paramId(req.params.id), req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/diagnose-agent-backend', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const credentials = agentCredentialsSchema.parse(req.body)
    const result = await diagnoseAgentBackend(paramId(req.params.id), credentials, req.user!.displayName)
    if (!result) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: result })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/repair-agent-backend-routes', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const credentials = agentCredentialsSchema.parse(req.body)
    const result = await repairAgentBackendRoutes(paramId(req.params.id), credentials, req.user!.displayName)
    if (!result) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: result })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/reinstall-agent', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const { apiBaseUrl, ...credentials } = reinstallAgentSchema.parse(req.body)
    const updated = await reinstallAgent(paramId(req.params.id), credentials, req.user!.displayName, { apiBaseUrl })
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

router.post('/:id/restart-agent', requirePermission(PERMISSIONS.HOSTS_AGENT), async (req: AuthRequest, res, next) => {
  try {
    const credentials = agentCredentialsSchema.parse(req.body)
    const updated = await restartAgent(paramId(req.params.id), credentials, req.user!.displayName)
    if (!updated) return res.status(404).json({ message: '主机不存在' })
    res.json({ data: updated })
  } catch (error) {
    next(error)
  }
})

export default router
