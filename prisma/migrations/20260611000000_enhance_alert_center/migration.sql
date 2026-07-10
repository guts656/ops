ALTER TABLE "alerts"
  ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT '平台',
  ADD COLUMN IF NOT EXISTS "title" TEXT,
  ADD COLUMN IF NOT EXISTS "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS "fingerprint" TEXT,
  ADD COLUMN IF NOT EXISTS "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "first_occurrence_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "last_occurrence_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "is_suppressed" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "suppression_reason" TEXT,
  ADD COLUMN IF NOT EXISTS "suppression_until" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "related_type" TEXT,
  ADD COLUMN IF NOT EXISTS "related_id" TEXT;

UPDATE "alerts"
SET
  "title" = COALESCE("title", LEFT("content", 80)),
  "first_occurrence_at" = COALESCE("first_occurrence_at", "created_at"),
  "last_occurrence_at" = COALESCE("last_occurrence_at", "updated_at")
WHERE "title" IS NULL OR "first_occurrence_at" IS NULL OR "last_occurrence_at" IS NULL;

CREATE INDEX IF NOT EXISTS "alerts_source_idx" ON "alerts"("source");
CREATE INDEX IF NOT EXISTS "alerts_fingerprint_idx" ON "alerts"("fingerprint");
CREATE INDEX IF NOT EXISTS "alerts_is_suppressed_idx" ON "alerts"("is_suppressed");

CREATE TABLE IF NOT EXISTS "alert_noise_records" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "service" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "occurrence_count" INTEGER NOT NULL DEFAULT 1,
  "first_occurrence_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_occurrence_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_suppressed" BOOLEAN NOT NULL DEFAULT false,
  "suppression_reason" TEXT,
  "suppression_until" TIMESTAMP(3),
  "latest_alert_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_noise_records_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "alert_noise_records_fingerprint_key" ON "alert_noise_records"("fingerprint");
CREATE INDEX IF NOT EXISTS "alert_noise_records_source_idx" ON "alert_noise_records"("source");
CREATE INDEX IF NOT EXISTS "alert_noise_records_service_idx" ON "alert_noise_records"("service");
CREATE INDEX IF NOT EXISTS "alert_noise_records_level_idx" ON "alert_noise_records"("level");
CREATE INDEX IF NOT EXISTS "alert_noise_records_is_suppressed_idx" ON "alert_noise_records"("is_suppressed");
CREATE INDEX IF NOT EXISTS "alert_noise_records_last_occurrence_at_idx" ON "alert_noise_records"("last_occurrence_at");
