ALTER TABLE "host_containers"
  ADD COLUMN IF NOT EXISTS "is_current" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "logical_key" TEXT,
  ADD COLUMN IF NOT EXISTS "retired_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "retired_reason" TEXT;

CREATE INDEX IF NOT EXISTS "host_containers_host_id_is_current_idx" ON "host_containers"("host_id", "is_current");
CREATE INDEX IF NOT EXISTS "host_containers_host_id_logical_key_idx" ON "host_containers"("host_id", "logical_key");
