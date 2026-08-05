CREATE TABLE "ipush_monitor_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "host_id" TEXT,
  "target_host" TEXT NOT NULL,
  "port" INTEGER NOT NULL,
  "system_code" TEXT NOT NULL,
  "service_code" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "encrypted_password" TEXT NOT NULL,
  "password_iv" TEXT NOT NULL,
  "password_tag" TEXT NOT NULL,
  "expected_greeting" TEXT NOT NULL DEFAULT 'xinit',
  "expected_login_result" TEXT NOT NULL DEFAULT 'xaucode 200_login_ok',
  "connect_timeout_ms" INTEGER NOT NULL DEFAULT 5000,
  "response_timeout_ms" INTEGER NOT NULL DEFAULT 5000,
  "interval_seconds" INTEGER NOT NULL DEFAULT 60,
  "failure_threshold" INTEGER NOT NULL DEFAULT 3,
  "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
  "alert_level" TEXT NOT NULL DEFAULT '严重',
  "days_of_week" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "time_ranges" JSONB NOT NULL DEFAULT '[]',
  "holiday_mode" TEXT NOT NULL DEFAULT 'ignore',
  "holidays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notification" JSONB NOT NULL DEFAULT '{}',
  "last_checked_at" TIMESTAMP(3),
  "last_triggered_at" TIMESTAMP(3),
  "last_healthy_at" TIMESTAMP(3),
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "trigger_count" INTEGER NOT NULL DEFAULT 0,
  "last_reachable" BOOLEAN,
  "last_latency_ms" INTEGER,
  "last_stage" TEXT NOT NULL DEFAULT '未检测',
  "last_error" TEXT,
  "last_response_snippet" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ipush_monitor_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ipush_monitor_alerts" (
  "id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "alert_id" TEXT NOT NULL,
  "stage" TEXT NOT NULL,
  "reachable" BOOLEAN NOT NULL,
  "latency_ms" INTEGER,
  "response_snippet" TEXT NOT NULL DEFAULT '',
  "error_message" TEXT NOT NULL DEFAULT '',
  "notification_results" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ipush_monitor_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ipush_monitor_rules_enabled_idx" ON "ipush_monitor_rules"("enabled");
CREATE INDEX "ipush_monitor_rules_host_id_idx" ON "ipush_monitor_rules"("host_id");
CREATE INDEX "ipush_monitor_rules_target_host_port_idx" ON "ipush_monitor_rules"("target_host", "port");
CREATE INDEX "ipush_monitor_rules_last_checked_at_idx" ON "ipush_monitor_rules"("last_checked_at");
CREATE INDEX "ipush_monitor_rules_last_triggered_at_idx" ON "ipush_monitor_rules"("last_triggered_at");
CREATE INDEX "ipush_monitor_alerts_rule_id_created_at_idx" ON "ipush_monitor_alerts"("rule_id", "created_at");
CREATE INDEX "ipush_monitor_alerts_alert_id_idx" ON "ipush_monitor_alerts"("alert_id");

ALTER TABLE "ipush_monitor_alerts"
ADD CONSTRAINT "ipush_monitor_alerts_rule_id_fkey"
FOREIGN KEY ("rule_id") REFERENCES "ipush_monitor_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
