import type { Permission, Role } from '../config/permissions'

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

export interface AccountFormValues {
  username?: string
  password?: string
  displayName: string
  role: Role
  title: string
  enabled: boolean
  customPermissions: Permission[]
}
