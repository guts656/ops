import bcrypt from 'bcryptjs'
import { PERMISSIONS, ROLE_LABELS, ROLE_PERMISSIONS, type Permission, type Role } from '../config/permissions'
import { prisma } from '../db/prisma'
import type { AuthUser } from '../types/auth'

type StoredUser = Awaited<ReturnType<typeof findStoredUser>>

const dummyPasswordHash = '$2a$10$7EqJtq98hPqEX7fNZaFWoOHiVEFuIkGHB8BQZMDQ0gIuE6qHnRmU6'

export interface AccountUser {
  id: string
  username: string
  displayName: string
  role: Role
  title: string
  enabled: boolean
  customPermissions: Permission[]
  permissions: Permission[]
  createdAt: string
  updatedAt: string
}

export interface AccountMetadata {
  roles: Array<{ value: Role; label: string }>
  rolePermissions: Record<Role, Permission[]>
  permissions: Array<{ key: Permission; label: string }>
}

const permissionLabels: Record<Permission, string> = {
  [PERMISSIONS.DASHBOARD_VIEW]: '查看仪表盘',
  [PERMISSIONS.ALERTS_VIEW]: '查看告警中心',
  [PERMISSIONS.ALERTS_MANAGE]: '处理告警中心',
  [PERMISSIONS.LOGS_VIEW]: '查看日志查询',
  [PERMISSIONS.TOPOLOGY_VIEW]: '查看服务拓扑',
  [PERMISSIONS.TOPOLOGY_MANAGE]: '管理服务拓扑',
  [PERMISSIONS.HOSTS_VIEW]: '查看主机管理',
  [PERMISSIONS.HOSTS_MANAGE]: '管理主机',
  [PERMISSIONS.HOSTS_AGENT]: '管理主机 Agent',
  [PERMISSIONS.HOSTS_DELETE]: '删除主机',
  [PERMISSIONS.ACCOUNTS_MANAGE]: '管理账号权限',
  [PERMISSIONS.AUDIT_LOG_VIEW]: '查看审计日志中心',
  [PERMISSIONS.INTERNAL_VIEW]: '查看内部系统',
  [PERMISSIONS.SELF_HEALING_VIEW]: '查看自愈规则',
  [PERMISSIONS.SELF_HEALING_MANAGE]: '管理自愈规则',
  [PERMISSIONS.AI_VIEW]: '查看 AI 助手',
  [PERMISSIONS.INSPECTION_VIEW]: '查看智能巡检',
  [PERMISSIONS.SETTINGS_VIEW]: '查看平台设置',
  [PERMISSIONS.SETTINGS_MANAGE]: '管理平台设置',
}

const validRoles: Role[] = ['admin', 'sre', 'auditor', 'viewer']
const validPermissions = Object.values(PERMISSIONS) as Permission[]

function isRole(role: string): role is Role {
  return validRoles.includes(role as Role)
}

function assertRole(role: string): Role {
  if (!isRole(role)) throw new Error('未知角色')
  return role
}

function assertPermissions(permissions: string[]): Permission[] {
  for (const permission of permissions) {
    if (!validPermissions.includes(permission as Permission)) throw new Error('包含未知权限')
  }
  return permissions as Permission[]
}

function uniquePermissions(permissions: Permission[]) {
  return Array.from(new Set(permissions))
}

function formatTime(date: Date) {
  return date.toLocaleString('zh-CN', { hour12: false })
}

export async function syncPermissionCatalog() {
  for (const permission of validPermissions) {
    await prisma.permission.upsert({
      where: { key: permission },
      update: { label: permissionLabels[permission] },
      create: { key: permission, label: permissionLabels[permission] },
    })
  }

  await prisma.rolePermission.deleteMany()
  for (const [role, permissions] of Object.entries(ROLE_PERMISSIONS) as Array<[Role, Permission[]]>) {
    for (const permission of permissions) {
      await prisma.rolePermission.create({ data: { role, permissionKey: permission } })
    }
  }
}

export async function findStoredUser(username: string) {
  return prisma.user.findUnique({
    where: { username },
    include: { customPermissions: true },
  })
}

export function toAuthUser(user: NonNullable<StoredUser>): AuthUser {
  const role = assertRole(user.role)
  const customPermissions = assertPermissions(user.customPermissions.map((item) => item.permissionKey))
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role,
    title: user.title,
    enabled: user.enabled,
    tokenVersion: user.tokenVersion,
    permissions: uniquePermissions([...ROLE_PERMISSIONS[role], ...customPermissions]),
  }
}

export async function verifyUser(username: string, password: string) {
  const user = await findStoredUser(username)
  if (!user || !user.enabled) {
    await bcrypt.compare(password, dummyPasswordHash)
    return undefined
  }
  const valid = await bcrypt.compare(password, user.passwordHash)
  return valid ? toAuthUser(user) : undefined
}

function toAccountUser(user: NonNullable<StoredUser>): AccountUser {
  const authUser = toAuthUser(user)
  const customPermissions = assertPermissions(user.customPermissions.map((item) => item.permissionKey))
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: authUser.role,
    title: user.title,
    enabled: user.enabled,
    customPermissions,
    permissions: authUser.permissions,
    createdAt: formatTime(user.createdAt),
    updatedAt: formatTime(user.updatedAt),
  }
}

async function writeAudit(operator: string, action: string, target: string, detail: string, result = '成功') {
  await prisma.auditLog.create({ data: { operator, action, target, detail, result } })
}

export async function listUsers() {
  const users = await prisma.user.findMany({
    include: { customPermissions: true },
    orderBy: { createdAt: 'asc' },
  })
  return users.map(toAccountUser)
}

export function getAccountMetadata(): AccountMetadata {
  return {
    roles: validRoles.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
    rolePermissions: ROLE_PERMISSIONS,
    permissions: validPermissions.map((permission) => ({ key: permission, label: permissionLabels[permission] })),
  }
}

export async function createUser(values: { username: string; password: string; displayName: string; role: Role; title: string; enabled: boolean; customPermissions: Permission[] }, operator: string) {
  const role = assertRole(values.role)
  const customPermissions = assertPermissions(values.customPermissions)
  const existing = await prisma.user.findUnique({ where: { username: values.username } })
  if (existing) throw new Error('用户名已存在')
  const passwordHash = await bcrypt.hash(values.password, 10)
  const user = await prisma.user.create({
    data: {
      username: values.username,
      passwordHash,
      displayName: values.displayName,
      role,
      title: values.title,
      enabled: values.enabled,
      customPermissions: { create: customPermissions.map((permissionKey) => ({ permissionKey })) },
    },
    include: { customPermissions: true },
  })
  await writeAudit(operator, '创建账号', values.username, `创建 ${ROLE_LABELS[role]} 账号`)
  return toAccountUser(user)
}

export async function updateUser(id: string, values: { displayName: string; role: Role; title: string; enabled: boolean; customPermissions: Permission[] }, operator: string) {
  const current = await prisma.user.findUnique({ where: { id }, include: { customPermissions: true } })
  if (!current) return undefined
  const role = assertRole(values.role)
  const customPermissions = assertPermissions(values.customPermissions)

  if (!values.enabled && current.enabled) await assertCanDisableOrDelete(current.id)

  const user = await prisma.$transaction(async (tx) => {
    await tx.userPermission.deleteMany({ where: { userId: id } })
    return tx.user.update({
      where: { id },
      data: {
        displayName: values.displayName,
        role,
        title: values.title,
        enabled: values.enabled,
        tokenVersion: { increment: 1 },
        customPermissions: { create: customPermissions.map((permissionKey) => ({ permissionKey })) },
      },
      include: { customPermissions: true },
    })
  })
  await writeAudit(operator, '编辑账号', current.username, `更新账号资料、角色和权限`)
  return toAccountUser(user)
}

async function assertCanDisableOrDelete(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId } })
  if (!user) throw new Error('账号不存在')
  if (user.role !== 'admin') return
  const enabledAdmins = await prisma.user.count({ where: { role: 'admin', enabled: true, id: { not: userId } } })
  if (enabledAdmins < 1) throw new Error('不能禁用或删除最后一个启用的管理员')
}

export async function setUserEnabled(id: string, enabled: boolean, operator: string, currentUserId: string) {
  if (id === currentUserId && !enabled) throw new Error('不能禁用当前登录账号')
  const current = await prisma.user.findUnique({ where: { id }, include: { customPermissions: true } })
  if (!current) return undefined
  if (!enabled && current.enabled) await assertCanDisableOrDelete(id)
  const user = await prisma.user.update({
    where: { id },
    data: { enabled, tokenVersion: { increment: 1 } },
    include: { customPermissions: true },
  })
  await writeAudit(operator, enabled ? '启用账号' : '禁用账号', current.username, enabled ? '账号已启用' : '账号已禁用')
  return toAccountUser(user)
}

export async function resetUserPassword(id: string, password: string, operator: string) {
  const current = await prisma.user.findUnique({ where: { id }, include: { customPermissions: true } })
  if (!current) return undefined
  const passwordHash = await bcrypt.hash(password, 10)
  const user = await prisma.user.update({
    where: { id },
    data: { passwordHash, tokenVersion: { increment: 1 } },
    include: { customPermissions: true },
  })
  await writeAudit(operator, '重置密码', current.username, '管理员重置账号密码')
  return toAccountUser(user)
}

export async function deleteUser(id: string, operator: string, currentUserId: string) {
  if (id === currentUserId) throw new Error('不能删除当前登录账号')
  const current = await prisma.user.findUnique({ where: { id }, include: { customPermissions: true } })
  if (!current) return undefined
  await assertCanDisableOrDelete(id)
  await prisma.user.delete({ where: { id } })
  await writeAudit(operator, '删除账号', current.username, '管理员删除账号')
  return toAccountUser(current)
}
