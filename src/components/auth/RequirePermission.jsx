import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../../stores/authStore'

export default function RequirePermission({ permission, children }) {
  const hasPermission = useAuthStore((state) => state.hasPermission)

  if (!hasPermission(permission)) {
    return <Navigate to="/403" replace />
  }

  return children
}
