import { Router } from 'express'
import { z } from 'zod'
import { PERMISSIONS } from '../config/permissions'
import { createBatchJob, getBatchJob, getBatchJobArtifact, listBatchJobs } from '../data/batchJobs'
import { authenticate } from '../middleware/authenticate'
import { requirePermission } from '../middleware/requirePermission'
import type { AuthRequest } from '../types/auth'

function paramId(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value
}

const fileJobTypes = new Set(['upload_file', 'compare_file', 'download_file'])

const batchJobSchema = z.object({
  name: z.string().min(1).max(80),
  type: z.enum(['upload_file', 'run_script', 'compare_file', 'download_file']),
  targetMode: z.enum(['hosts', 'group']).optional(),
  targetOs: z.enum(['Linux', 'Windows']).optional(),
  hostIds: z.array(z.string().min(1)).max(50).optional(),
  hostGroup: z.string().optional(),
  targetDirectory: z.string().optional(),
  fileName: z.string().optional(),
  fileContentBase64: z.string().optional(),
  fileMd5: z.string().regex(/^[a-fA-F0-9]{32}$/).optional(),
  maxFileSize: z.coerce.number().int().positive().max(5 * 1024 * 1024).optional(),
  backupExisting: z.boolean().optional(),
  script: z.string().optional(),
}).superRefine((value, ctx) => {
  const targetMode = value.targetMode || 'hosts'
  if (targetMode === 'hosts' && !value.hostIds?.length) ctx.addIssue({ code: 'custom', path: ['hostIds'], message: '请选择目标主机' })
  if (targetMode === 'group' && !value.hostGroup?.trim()) ctx.addIssue({ code: 'custom', path: ['hostGroup'], message: '请选择主机组' })
  if (targetMode === 'group' && !value.targetOs) ctx.addIssue({ code: 'custom', path: ['targetOs'], message: '请选择目标系统' })
  if (fileJobTypes.has(value.type)) {
    if (!value.targetDirectory) ctx.addIssue({ code: 'custom', path: ['targetDirectory'], message: '请填写目标目录' })
    if (!value.fileName) ctx.addIssue({ code: 'custom', path: ['fileName'], message: '请填写文件名' })
  }
  if (value.type === 'upload_file' && !value.fileContentBase64) {
    ctx.addIssue({ code: 'custom', path: ['fileContentBase64'], message: '请上传文件' })
  }
  if (value.type === 'run_script' && !value.script?.trim()) {
    ctx.addIssue({ code: 'custom', path: ['script'], message: '请填写脚本内容' })
  }
})

const router = Router()
router.use(authenticate)

router.get('/', requirePermission(PERMISSIONS.BATCH_VIEW), async (_req, res, next) => {
  try {
    res.json({ data: await listBatchJobs() })
  } catch (error) {
    next(error)
  }
})

router.get('/:id', requirePermission(PERMISSIONS.BATCH_VIEW), async (req, res, next) => {
  try {
    const job = await getBatchJob(paramId(req.params.id))
    if (!job) return res.status(404).json({ message: '批处理任务不存在' })
    res.json({ data: job })
  } catch (error) {
    next(error)
  }
})

router.get('/:id/artifacts/:artifactId/download', requirePermission(PERMISSIONS.BATCH_VIEW), async (req, res, next) => {
  try {
    const result = await getBatchJobArtifact(paramId(req.params.id), paramId(req.params.artifactId))
    if (!result) return res.status(404).json({ message: '文件不存在或已清理' })
    res.setHeader('Content-Type', result.artifact.mimeType || 'application/octet-stream')
    res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(result.fileName)}"`)
    res.setHeader('X-Content-Type-Options', 'nosniff')
    res.send(result.content)
  } catch (error) {
    next(error)
  }
})

router.post('/', requirePermission(PERMISSIONS.BATCH_EXECUTE), async (req: AuthRequest, res, next) => {
  try {
    const values = batchJobSchema.parse(req.body)
    res.json({ data: await createBatchJob(values, req.user!.displayName) })
  } catch (error) {
    next(error)
  }
})

export default router
