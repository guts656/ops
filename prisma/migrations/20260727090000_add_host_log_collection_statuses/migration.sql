CREATE TABLE IF NOT EXISTS "host_log_collection_statuses" (
  "host_id" TEXT NOT NULL,
  "collector" TEXT NOT NULL DEFAULT 'ops-agent',
  "status" TEXT NOT NULL DEFAULT 'ok',
  "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "config_paths" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "matched_files" INTEGER NOT NULL DEFAULT 0,
  "read_lines" INTEGER NOT NULL DEFAULT 0,
  "uploaded_lines" INTEGER NOT NULL DEFAULT 0,
  "event_logs" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "paths" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "raw_payload" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "host_log_collection_statuses_pkey" PRIMARY KEY ("host_id"),
  CONSTRAINT "host_log_collection_statuses_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "host_log_collection_statuses_status_idx" ON "host_log_collection_statuses"("status");
CREATE INDEX IF NOT EXISTS "host_log_collection_statuses_sampled_at_idx" ON "host_log_collection_statuses"("sampled_at");
