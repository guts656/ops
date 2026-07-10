CREATE TABLE IF NOT EXISTS "alert_webhook_logs" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "alert_count" INTEGER NOT NULL DEFAULT 0,
  "resolved_count" INTEGER NOT NULL DEFAULT 0,
  "error_message" TEXT,
  "request_body" JSONB,
  "ip_address" TEXT,
  "user_agent" TEXT,
  "processing_time_ms" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_webhook_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "alert_webhook_logs_source_idx" ON "alert_webhook_logs"("source");
CREATE INDEX IF NOT EXISTS "alert_webhook_logs_status_idx" ON "alert_webhook_logs"("status");
CREATE INDEX IF NOT EXISTS "alert_webhook_logs_created_at_idx" ON "alert_webhook_logs"("created_at");

CREATE TABLE IF NOT EXISTS "notifications" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "level" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "read_at" TIMESTAMP(3),
  "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "notifications_type_idx" ON "notifications"("type");
CREATE INDEX IF NOT EXISTS "notifications_level_idx" ON "notifications"("level");
CREATE INDEX IF NOT EXISTS "notifications_read_at_idx" ON "notifications"("read_at");
CREATE INDEX IF NOT EXISTS "notifications_created_at_idx" ON "notifications"("created_at");
CREATE INDEX IF NOT EXISTS "notifications_entity_type_entity_id_idx" ON "notifications"("entity_type", "entity_id");

ALTER TABLE "self_healing_executions"
  ADD COLUMN IF NOT EXISTS "alert_id" TEXT;

CREATE INDEX IF NOT EXISTS "self_healing_executions_alert_id_idx" ON "self_healing_executions"("alert_id");

CREATE TABLE IF NOT EXISTS "alert_handling_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "priority" INTEGER NOT NULL DEFAULT 100,
  "alert_source" TEXT,
  "alert_level" TEXT,
  "title_pattern" TEXT,
  "service_pattern" TEXT,
  "matchers" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "self_healing_rule_id" TEXT NOT NULL,
  "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
  "auto_execute" BOOLEAN NOT NULL DEFAULT false,
  "last_triggered_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "alert_handling_rules_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "alert_handling_rules_enabled_idx" ON "alert_handling_rules"("enabled");
CREATE INDEX IF NOT EXISTS "alert_handling_rules_priority_idx" ON "alert_handling_rules"("priority");
CREATE INDEX IF NOT EXISTS "alert_handling_rules_alert_source_idx" ON "alert_handling_rules"("alert_source");
CREATE INDEX IF NOT EXISTS "alert_handling_rules_alert_level_idx" ON "alert_handling_rules"("alert_level");
CREATE INDEX IF NOT EXISTS "alert_handling_rules_self_healing_rule_id_idx" ON "alert_handling_rules"("self_healing_rule_id");

ALTER TABLE "alert_handling_rules"
  ADD CONSTRAINT "alert_handling_rules_self_healing_rule_id_fkey"
  FOREIGN KEY ("self_healing_rule_id") REFERENCES "self_healing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
