import axios from 'axios'

export const http = axios.create({
  baseURL: '/api',
})

http.interceptors.request.use((config) => {
  const session = window.localStorage.getItem('ops-platform.auth.session')
  if (session) {
    try {
      const { token } = JSON.parse(session)
      if (token) config.headers.Authorization = `Bearer ${token}`
    } catch {
      window.localStorage.removeItem('ops-platform.auth.session')
    }
  }
  return config
})

http.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      window.localStorage.removeItem('ops-platform.auth.session')
      if (window.location.pathname !== '/login') {
        window.location.href = `/login?redirect=${encodeURIComponent(`${window.location.pathname}${window.location.search}`)}`
      }
    }
    return Promise.reject(error)
  },
)

export function getErrorTraceId(error: unknown) {
  if (!axios.isAxiosError(error)) return undefined
  return error.response?.data?.traceId || error.response?.headers?.['x-trace-id']
}

export function getErrorMessage(error: unknown, fallback = '请求失败') {
  if (axios.isAxiosError(error)) {
    const message = error.response?.data?.message ?? error.message ?? fallback
    const traceId = getErrorTraceId(error)
    return traceId ? `${message}（Trace ID: ${traceId}）` : message
  }
  return error instanceof Error ? error.message : fallback
}
