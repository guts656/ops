import { http } from './http'
import type { SslCertificateCheckResponse, SslCertificateHistory, SslCertificateMonitor, SslCertificateMonitorInput } from '../types/sslCertificate'

export async function listSslCertificateMonitors(): Promise<SslCertificateMonitor[]> {
  const response = await http.get<{ data: SslCertificateMonitor[] }>('/ssl-certificates/monitors')
  return response.data.data
}

export async function createSslCertificateMonitor(values: SslCertificateMonitorInput): Promise<SslCertificateMonitor> {
  const response = await http.post<{ data: SslCertificateMonitor }>('/ssl-certificates/monitors', values, { timeout: 60000 })
  return response.data.data
}

export async function updateSslCertificateMonitor(id: string, values: SslCertificateMonitorInput): Promise<SslCertificateMonitor> {
  const response = await http.put<{ data: SslCertificateMonitor }>(`/ssl-certificates/monitors/${id}`, values, { timeout: 60000 })
  return response.data.data
}

export async function deleteSslCertificateMonitor(id: string): Promise<SslCertificateMonitor> {
  const response = await http.delete<{ data: SslCertificateMonitor }>(`/ssl-certificates/monitors/${id}`)
  return response.data.data
}

export async function checkSslCertificateMonitor(id: string): Promise<SslCertificateCheckResponse> {
  const response = await http.post<{ data: SslCertificateCheckResponse }>(`/ssl-certificates/monitors/${id}/check`, undefined, { timeout: 60000 })
  return response.data.data
}

export async function listSslCertificateHistories(monitorId?: string): Promise<SslCertificateHistory[]> {
  const response = await http.get<{ data: SslCertificateHistory[] }>('/ssl-certificates/histories', { params: { monitorId } })
  return response.data.data
}
