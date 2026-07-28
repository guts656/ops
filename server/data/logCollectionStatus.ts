import { Prisma } from '../../src/generated/prisma/client'
import { prisma } from '../db/prisma.ts'

export interface HostLogCollectionPathStatus {
  path: string
  expandedPath?: string
  exists?: boolean
  matchedFiles: number
  readLines: number
  uploadedLines: number
  error?: string
  files?: string[]
}

export interface HostLogCollectionStatusInput {
  collector?: string
  status?: 'ok' | 'warning' | 'error'
  sampledAt?: Date
  configPaths?: string[]
  matchedFiles?: number
  readLines?: number
  uploadedLines?: number
  eventLogs?: number
  lastError?: string
  paths?: HostLogCollectionPathStatus[]
  rawPayload?: unknown
}

export interface HostLogCollectionStatus {
  hostId: string
  collector: string
  status: 'ok' | 'warning' | 'error'
  sampledAt: string
  configPaths: string[]
  matchedFiles: number
  readLines: number
  uploadedLines: number
  eventLogs: number
  lastError?: string
  paths: HostLogCollectionPathStatus[]
  rawPayload?: unknown
  updatedAt: string
}

type HostLogCollectionStatusRow = {
  host_id: string
  collector: string
  status: string
  sampled_at: Date
  config_paths: string[]
  matched_files: number
  read_lines: number
  uploaded_lines: number
  event_logs: number
  error_message: string | null
  paths: unknown
  raw_payload: unknown
  updated_at: Date
}

function compactText(value: unknown, maxLength: number) {
  const text = value === undefined || value === null ? '' : String(value)
  return text.length > maxLength ? text.slice(0, maxLength) : text
}

function nonNegativeInt(value: unknown) {
  const number = Number(value || 0)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0
}

function textArray(values: string[] | undefined, maxItems = 50) {
  const items = (values ?? []).map((value) => compactText(value, 500).trim()).filter(Boolean).slice(0, maxItems)
  if (!items.length) return Prisma.sql`ARRAY[]::TEXT[]`
  return Prisma.sql`ARRAY[${Prisma.join(items)}]::TEXT[]`
}

function jsonb(value: unknown) {
  return Prisma.sql`CAST(${JSON.stringify(value ?? {})} AS jsonb)`
}

function normalizePathStatus(value: HostLogCollectionPathStatus): HostLogCollectionPathStatus {
  return {
    path: compactText(value.path, 500),
    expandedPath: value.expandedPath ? compactText(value.expandedPath, 500) : undefined,
    exists: value.exists,
    matchedFiles: nonNegativeInt(value.matchedFiles),
    readLines: nonNegativeInt(value.readLines),
    uploadedLines: nonNegativeInt(value.uploadedLines),
    error: value.error ? compactText(value.error, 1000) : undefined,
    files: value.files?.map((file) => compactText(file, 500)).filter(Boolean).slice(0, 20),
  }
}

function normalizeStatus(value: string | undefined, input: HostLogCollectionStatusInput) {
  if (value === 'ok' || value === 'warning' || value === 'error') return value
  if (input.lastError) return 'error'
  if ((input.configPaths?.length ?? 0) > 0 && nonNegativeInt(input.matchedFiles) === 0) return 'warning'
  return 'ok'
}

function toStatus(row: HostLogCollectionStatusRow): HostLogCollectionStatus {
  return {
    hostId: row.host_id,
    collector: row.collector,
    status: normalizeStatus(row.status, {}),
    sampledAt: row.sampled_at.toISOString(),
    configPaths: row.config_paths ?? [],
    matchedFiles: row.matched_files,
    readLines: row.read_lines,
    uploadedLines: row.uploaded_lines,
    eventLogs: row.event_logs,
    lastError: row.error_message ?? undefined,
    paths: Array.isArray(row.paths) ? row.paths as HostLogCollectionPathStatus[] : [],
    rawPayload: row.raw_payload ?? undefined,
    updatedAt: row.updated_at.toISOString(),
  }
}

export async function upsertHostLogCollectionStatus(hostId: string, input: HostLogCollectionStatusInput) {
  const paths = (input.paths ?? []).map(normalizePathStatus).slice(0, 50)
  const configPaths = input.configPaths?.length ? input.configPaths : paths.map((item) => item.path).filter(Boolean)
  const status = normalizeStatus(input.status, { ...input, configPaths })
  const sampledAt = input.sampledAt ?? new Date()
  const collector = compactText(input.collector || 'ops-agent', 80)
  const lastError = input.lastError ? compactText(input.lastError, 1000) : null
  const rawPayload = input.rawPayload ?? { ...input, sampledAt: sampledAt.toISOString() }

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO host_log_collection_statuses (
      host_id,
      collector,
      status,
      sampled_at,
      config_paths,
      matched_files,
      read_lines,
      uploaded_lines,
      event_logs,
      error_message,
      paths,
      raw_payload,
      updated_at
    ) VALUES (
      ${hostId},
      ${collector},
      ${status},
      ${sampledAt},
      ${textArray(configPaths, 50)},
      ${nonNegativeInt(input.matchedFiles)},
      ${nonNegativeInt(input.readLines)},
      ${nonNegativeInt(input.uploadedLines)},
      ${nonNegativeInt(input.eventLogs)},
      ${lastError},
      ${jsonb(paths)},
      ${jsonb(rawPayload)},
      NOW()
    )
    ON CONFLICT (host_id) DO UPDATE SET
      collector = EXCLUDED.collector,
      status = EXCLUDED.status,
      sampled_at = EXCLUDED.sampled_at,
      config_paths = EXCLUDED.config_paths,
      matched_files = EXCLUDED.matched_files,
      read_lines = EXCLUDED.read_lines,
      uploaded_lines = EXCLUDED.uploaded_lines,
      event_logs = EXCLUDED.event_logs,
      error_message = EXCLUDED.error_message,
      paths = EXCLUDED.paths,
      raw_payload = EXCLUDED.raw_payload,
      updated_at = NOW()
  `)
}

export async function getHostLogCollectionStatus(hostId: string) {
  const rows = await prisma.$queryRaw<HostLogCollectionStatusRow[]>(Prisma.sql`
    SELECT
      host_id,
      collector,
      status,
      sampled_at,
      config_paths,
      matched_files,
      read_lines,
      uploaded_lines,
      event_logs,
      error_message,
      paths,
      raw_payload,
      updated_at
    FROM host_log_collection_statuses
    WHERE host_id = ${hostId}
    LIMIT 1
  `)
  return rows[0] ? toStatus(rows[0]) : undefined
}
