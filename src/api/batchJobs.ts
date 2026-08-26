import type { BatchJob, BatchJobArtifact, CreateBatchJobValues } from '../types/batchJob'
import { http } from './http'

export async function listBatchJobs(): Promise<BatchJob[]> {
  const response = await http.get<{ data: BatchJob[] }>('/batch-jobs')
  return response.data.data
}

export async function getBatchJob(id: string): Promise<BatchJob> {
  const response = await http.get<{ data: BatchJob }>(`/batch-jobs/${id}`)
  return response.data.data
}

export async function createBatchJob(values: CreateBatchJobValues): Promise<BatchJob> {
  const response = await http.post<{ data: BatchJob }>('/batch-jobs', values)
  return response.data.data
}

export async function rerunFailedBatchJob(id: string): Promise<BatchJob> {
  const response = await http.post<{ data: BatchJob }>(`/batch-jobs/${id}/rerun-failed`)
  return response.data.data
}

export async function downloadBatchArtifact(jobId: string, artifact: BatchJobArtifact) {
  const response = await http.get<Blob>(`/batch-jobs/${jobId}/artifacts/${artifact.id}/download`, { responseType: 'blob' })
  const url = window.URL.createObjectURL(response.data)
  const link = document.createElement('a')
  link.href = url
  link.download = artifact.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.URL.revokeObjectURL(url)
}
