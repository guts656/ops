import { cloneElement, isValidElement } from 'react'
import { Tooltip } from 'antd'
import { useAuthStore } from '../../stores/authStore'

export default function PermissionGate({ permission, permissions = [], mode = 'hide', tooltip = '当前角色无权限', children, fallback = null }) {
  const hasPermission = useAuthStore((state) => state.hasPermission)
  const hasAnyPermission = useAuthStore((state) => state.hasAnyPermission)
  const allowed = permission ? hasPermission(permission) : hasAnyPermission(permissions)

  if (allowed) return children
  if (mode === 'disable' && isValidElement(children)) {
    return <Tooltip title={tooltip}>{cloneElement(children, { disabled: true })}</Tooltip>
  }

  return fallback
}
