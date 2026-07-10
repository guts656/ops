CREATE TABLE "host_resource_monitor_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "host_id" TEXT,
  "host_scope" TEXT NOT NULL DEFAULT 'all',
  "host_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "host_group" TEXT,
  "metrics" TEXT[] NOT NULL DEFAULT ARRAY['cpu', 'memory', 'disk']::TEXT[],
  "threshold" INTEGER NOT NULL DEFAULT 80,
  "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
  "alert_level" TEXT NOT NULL DEFAULT '警告',
  "days_of_week" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "time_ranges" JSONB NOT NULL DEFAULT '[]',
  "holiday_mode" TEXT NOT NULL DEFAULT 'ignore',
  "holidays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notification" JSONB NOT NULL DEFAULT '{}',
  "last_evaluated_at" TIMESTAMP(3),
  "last_triggered_at" TIMESTAMP(3),
  "trigger_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "host_resource_monitor_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "host_resource_monitor_alerts" (
  "id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "alert_id" TEXT NOT NULL,
  "host_id" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "value" INTEGER NOT NULL,
  "threshold" INTEGER NOT NULL,
  "sampled_at" TIMESTAMP(3) NOT NULL,
  "notification_results" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "host_resource_monitor_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "host_resource_monitor_rules_enabled_idx" ON "host_resource_monitor_rules"("enabled");
CREATE INDEX "host_resource_monitor_rules_host_id_idx" ON "host_resource_monitor_rules"("host_id");
CREATE INDEX "host_resource_monitor_rules_host_scope_idx" ON "host_resource_monitor_rules"("host_scope");
CREATE INDEX "host_resource_monitor_rules_host_group_idx" ON "host_resource_monitor_rules"("host_group");
CREATE INDEX "host_resource_monitor_rules_last_triggered_at_idx" ON "host_resource_monitor_rules"("last_triggered_at");
CREATE INDEX "host_resource_monitor_alerts_rule_id_created_at_idx" ON "host_resource_monitor_alerts"("rule_id", "created_at");
CREATE INDEX "host_resource_monitor_alerts_host_id_created_at_idx" ON "host_resource_monitor_alerts"("host_id", "created_at");
CREATE INDEX "host_resource_monitor_alerts_alert_id_idx" ON "host_resource_monitor_alerts"("alert_id");

ALTER TABLE "host_resource_monitor_alerts" ADD CONSTRAINT "host_resource_monitor_alerts_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "host_resource_monitor_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
