import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { createTopology, createTopologyEdge, createTopologyNode, deleteTopology, deleteTopologyEdge, deleteTopologyNode, listTopologies, listTopology, syncDynamicTopology, updateTopology, updateTopologyCanvas, updateTopologyEdge, updateTopologyNode, updateTopologyNodePositions } from '../data/topology'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'

const topologySchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.string().trim().min(1).max(40),
  mode: z.enum(['structured', 'canvas']).optional(),
  remark: z.string().trim().max(500).optional(),
})

const canvasSchema = z.object({
  version: z.coerce.number().int().min(1).default(1),
  items: z.array(z.unknown()).max(500).default([]),
})

const nodeSchema = z.object({
  name: z.string().trim().min(1).max(80),
  type: z.enum(['business', 'service', 'host', 'database', 'middleware', 'agent', 'container', 'note']),
  status: z.string().trim().max(30).optional(),
  description: z.string().trim().max(500).optional(),
  x: z.coerce.number().int().min(0).max(1400).optional(),
  y: z.coerce.number().int().min(0).max(1400).optional(),
})

const edgeSchema = z.object({
  sourceId: z.string().trim().min(1),
  targetId: z.string().trim().min(1),
  label: z.string().trim().min(1).max(80),
})

const positionsSchema = z.object({
  positions: z.array(z.object({
    id: z.string().trim().min(1),
    x: z.coerce.number().int().min(0).max(1400),
    y: z.coerce.number().int().min(0).max(1400),
  })).max(200),
})

const router = Router()
router.use(authenticate)

router.get('/items', requirePermission(PERMISSIONS.TOPOLOGY_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await listTopologies() })
  } catch (error) {
    next(error)
  }
})

router.post('/items', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await createTopology(topologySchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.put('/items/:topologyId', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateTopology(req.params.topologyId, topologySchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.delete('/items/:topologyId', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    await deleteTopology(req.params.topologyId)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.get('/items/:topologyId/graph', requirePermission(PERMISSIONS.TOPOLOGY_VIEW), async (req, res, next) => {
  try {
    res.json({ data: await listTopology(req.params.topologyId) })
  } catch (error) {
    next(error)
  }
})

router.put('/items/:topologyId/canvas', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateTopologyCanvas(req.params.topologyId, canvasSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.post('/items/:topologyId/sync', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await syncDynamicTopology(req.params.topologyId) })
  } catch (error) {
    next(error)
  }
})

router.post('/items/:topologyId/nodes', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await createTopologyNode(req.params.topologyId, nodeSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.put('/items/:topologyId/nodes/:id', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateTopologyNode(req.params.topologyId, req.params.id, nodeSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.delete('/items/:topologyId/nodes/:id', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    await deleteTopologyNode(req.params.topologyId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.post('/items/:topologyId/edges', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await createTopologyEdge(req.params.topologyId, edgeSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.put('/items/:topologyId/edges/:id', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateTopologyEdge(req.params.topologyId, req.params.id, edgeSchema.parse(req.body)) })
  } catch (error) {
    next(error)
  }
})

router.delete('/items/:topologyId/edges/:id', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    await deleteTopologyEdge(req.params.topologyId, req.params.id)
    res.json({ success: true })
  } catch (error) {
    next(error)
  }
})

router.put('/items/:topologyId/layout', requirePermission(PERMISSIONS.TOPOLOGY_MANAGE), async (req, res, next) => {
  try {
    res.json({ data: await updateTopologyNodePositions(req.params.topologyId, positionsSchema.parse(req.body).positions) })
  } catch (error) {
    next(error)
  }
})

export default router
