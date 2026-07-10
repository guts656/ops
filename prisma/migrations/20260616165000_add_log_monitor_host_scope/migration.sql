ALTER TABLE "log_monitor_rules" ADD COLUMN "host_scope" TEXT NOT NULL DEFAULT 'all';
ALTER TABLE "log_monitor_rules" ADD COLUMN "host_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "log_monitor_rules" ADD COLUMN "host_group" TEXT;

UPDATE "log_monitor_rules"
SET "host_scope" = 'single', "host_ids" = ARRAY["host_id"]::TEXT[]
WHERE "host_id" IS NOT NULL AND "host_id" <> '';

CREATE INDEX "log_monitor_rules_host_scope_idx" ON "log_monitor_rules"("host_scope");
CREATE INDEX "log_monitor_rules_host_group_idx" ON "log_monitor_rules"("host_group");
