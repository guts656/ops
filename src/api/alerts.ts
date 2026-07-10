import type { AlertDiagnosisResult, AlertFilters, AlertItem, AlertNoiseStats, AlertSummary, CreateAlertInput, CreateAlertResult, SuppressAlertInput, SuppressedAlertRecord } from '../types/alert'
import { http } from './http'

export async function queryAlerts(filters: AlertFilters = {}): Promise<AlertItem[]> {
  const response = await http.get<{ data: AlertItem[] }>('/alerts', { params: filters })
  return response.data.data
}

export async function createAlert(input: CreateAlertInput): Promise<CreateAlertResult> {
  const response = await http.post<{ data: CreateAlertResult }>('/alerts', input)
  return response.data.data
}

export async function getAlertSummary(): Promise<AlertSummary> {
  const response = await http.get<{ data: AlertSummary }>('/alerts/summary')
  return response.data.data
}

export async function getAlertNoiseStats(): Promise<AlertNoiseStats> {
  const response = await http.get<{ data: AlertNoiseStats }>('/alerts/noise/stats')
  return response.data.data
}

export async function listSuppressedAlerts(): Promise<SuppressedAlertRecord[]> {
  const response = await http.get<{ data: SuppressedAlertRecord[] }>('/alerts/noise/suppressed')
  return response.data.data
}

export async function suppressAlertFingerprint(input: SuppressAlertInput): Promise<SuppressedAlertRecord> {
  const response = await http.post<{ data: SuppressedAlertRecord }>('/alerts/noise/suppress', input)
  return response.data.data
}

export async function unsuppressAlertFingerprint(fingerprint: string): Promise<SuppressedAlertRecord> {
  const response = await http.post<{ data: SuppressedAlertRecord }>('/alerts/noise/unsuppress', { fingerprint })
  return response.data.data
}

export async function acknowledgeAlert(id: string): Promise<AlertItem> {
  const response = await http.post<{ data: AlertItem }>(`/alerts/${id}/acknowledge`)
  return response.data.data
}

export async function resolveAlert(id: string): Promise<AlertItem> {
  const response = await http.post<{ data: AlertItem }>(`/alerts/${id}/resolve`)
  return response.data.data
}

export async function diagnoseAlert(id: string): Promise<AlertDiagnosisResult> {
  const response = await http.post<{ data: AlertDiagnosisResult }>(`/alerts/${id}/diagnose`)
  return response.data.data
}
