import { prisma } from '../db/prisma.ts'

export interface LogCollectionRuleInput {
  scope: 'host' | 'group'
  hostId?: string
  hostGroup?: string
  paths: string[]
  enabled?: boolean
}

function normalizePaths(paths: string[]) {
  return [...new Set(paths.map((path) => path.trim()).filter(Boolean))]
}

export async function getLogCollectionRules() {
  return prisma.logCollectionRule.findMany({ orderBy: [{ scope: 'asc' }, { updatedAt: 'desc' }] })
}

export async function saveLogCollectionRule(input: LogCollectionRuleInput) {
  const paths = normalizePaths(input.paths)
  if (!paths.length) throw new Error('至少配置一个日志路径')
  if (input.scope === 'host' && !input.hostId) throw new Error('请选择主机')
  if (input.scope === 'group' && !input.hostGroup) throw new Error('请选择主机组')

  const existing = await prisma.logCollectionRule.findFirst({
    where: input.scope === 'host' ? { scope: 'host', hostId: input.hostId } : { scope: 'group', hostGroup: input.hostGroup },
  })
  const data = { scope: input.scope, hostId: input.scope === 'host' ? input.hostId : null, hostGroup: input.scope === 'group' ? input.hostGroup : null, paths, enabled: input.enabled ?? true }
  if (existing) return prisma.logCollectionRule.update({ where: { id: existing.id }, data })
  return prisma.logCollectionRule.create({ data })
}

export async function deleteLogCollectionRule(id: string) {
  return prisma.logCollectionRule.delete({ where: { id } })
}

export async function getHostLogCollectionPaths(hostId: string) {
  const host = await prisma.host.findUnique({ where: { id: hostId }, select: { group: true } })
  if (!host) return []
  const rules = await prisma.logCollectionRule.findMany({
    where: {
      enabled: true,
      OR: [{ scope: 'host', hostId }, { scope: 'group', hostGroup: host.group }],
    },
  })
  return normalizePaths(rules.flatMap((rule) => rule.paths))
}
