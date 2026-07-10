ALTER TABLE "hosts"
  ADD COLUMN "maintenance_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "maintenance_reason" TEXT,
  ADD COLUMN "maintenance_until" TIMESTAMP(3),
  ADD COLUMN "maintenance_started_at" TIMESTAMP(3),
  ADD COLUMN "maintenance_operator" TEXT;

CREATE INDEX "hosts_maintenance_enabled_maintenance_until_idx" ON "hosts"("maintenance_enabled", "maintenance_until");
