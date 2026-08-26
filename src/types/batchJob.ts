export type BatchJobType = 'upload_file' | 'run_script' | 'compare_file' | 'download_file'
export type BatchJobStatus = 'running' | 'success' | 'failed' | 'partial'
export type BatchTargetMode = 'hosts' | 'group'

export interface BatchJobArtifact {
  id: string
  jobId: string
  targetId: string
  hostId: string
  fileName: string
  remotePath: string
  size: number
  md5: string
  mimeType?: string
  createdAt: string
}

export interface BatchJobTarget {
  id: string
  jobId: string
  hostId: string
  hostIp: string
  hostname: string
  status: BatchJobStatus
  remotePath?: string
  exitCode?: number
  stdout: string
  stderr: string
  summary: string
  startedAt: string
  completedAt?: string
  artifacts?: BatchJobArtifact[]
}

export interface BatchJob {
  id: string
  name: string
  type: BatchJobType
  status: BatchJobStatus
  operator: string
  targetMode?: BatchTargetMode
  hostGroup?: string
  targetDirectory?: string
  fileName?: string
  fileSize?: number
  fileMd5?: string
  baselineMd5?: string
  retryOfJobId?: string
  maxFileSize?: number
  script?: string
  startedAt: string
  completedAt?: string
  summary: string
  totalTargets: number
  successTargets: number
  failedTargets: number
  targets: BatchJobTarget[]
  artifacts?: BatchJobArtifact[]
}

export interface CreateBatchJobValues {
  name: string
  type: BatchJobType
  targetMode?: BatchTargetMode
  targetOs?: 'Linux' | 'Windows'
  hostIds?: string[]
  hostGroup?: string
  targetDirectory?: string
  fileName?: string
  fileContentBase64?: string
  fileMd5?: string
  maxFileSize?: number
  script?: string
}
