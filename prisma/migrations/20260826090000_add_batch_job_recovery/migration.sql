CREATE TABLE IF NOT EXISTS "batch_job_artifacts" (
  "id" TEXT NOT NULL,
  "job_id" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "host_id" TEXT NOT NULL,
  "file_name" TEXT NOT NULL,
  "remote_path" TEXT NOT NULL,
  "local_path" TEXT NOT NULL,
  "size" INTEGER NOT NULL,
  "md5" TEXT NOT NULL,
  "mime_type" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "batch_job_artifacts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "batch_job_artifacts_job_id_idx" ON "batch_job_artifacts"("job_id");
DROP INDEX IF EXISTS "batch_job_artifacts_target_id_idx";
WITH duplicate_artifacts AS (
  SELECT "id", ROW_NUMBER() OVER (PARTITION BY "target_id" ORDER BY "created_at" DESC, "id" DESC) AS row_number
  FROM "batch_job_artifacts"
)
DELETE FROM "batch_job_artifacts"
WHERE "id" IN (SELECT "id" FROM duplicate_artifacts WHERE row_number > 1);
CREATE UNIQUE INDEX IF NOT EXISTS "batch_job_artifacts_target_id_key" ON "batch_job_artifacts"("target_id");
CREATE INDEX IF NOT EXISTS "batch_job_artifacts_host_id_idx" ON "batch_job_artifacts"("host_id");

DO $$ BEGIN
  ALTER TABLE "batch_job_artifacts"
    ADD CONSTRAINT "batch_job_artifacts_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "batch_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "batch_job_artifacts"
    ADD CONSTRAINT "batch_job_artifacts_target_id_fkey"
    FOREIGN KEY ("target_id") REFERENCES "batch_job_targets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "batch_job_artifacts"
    ADD CONSTRAINT "batch_job_artifacts_host_id_fkey"
    FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "batch_jobs"
  ADD COLUMN IF NOT EXISTS "retry_of_job_id" TEXT,
  ADD COLUMN IF NOT EXISTS "source_file_path" TEXT,
  ADD COLUMN IF NOT EXISTS "source_file_expires_at" TIMESTAMP(3);

CREATE UNIQUE INDEX IF NOT EXISTS "batch_jobs_retry_of_job_id_key" ON "batch_jobs"("retry_of_job_id");
CREATE INDEX IF NOT EXISTS "batch_jobs_source_file_expires_at_idx" ON "batch_jobs"("source_file_expires_at");

DO $$ BEGIN
  ALTER TABLE "batch_jobs"
    ADD CONSTRAINT "batch_jobs_retry_of_job_id_fkey"
    FOREIGN KEY ("retry_of_job_id") REFERENCES "batch_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
