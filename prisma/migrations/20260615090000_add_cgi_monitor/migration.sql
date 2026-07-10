CREATE TABLE "cgi_monitor_rules" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL DEFAULT '',
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "url" TEXT NOT NULL,
  "method" TEXT NOT NULL DEFAULT 'GET',
  "keyword" TEXT NOT NULL,
  "match_mode" TEXT NOT NULL DEFAULT 'contains',
  "expected_status" INTEGER,
  "timeout_ms" INTEGER NOT NULL DEFAULT 8000,
  "interval_seconds" INTEGER NOT NULL DEFAULT 60,
  "failure_threshold" INTEGER NOT NULL DEFAULT 1,
  "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
  "alert_level" TEXT NOT NULL DEFAULT '警告',
  "days_of_week" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[],
  "time_ranges" JSONB NOT NULL DEFAULT '[]',
  "holiday_mode" TEXT NOT NULL DEFAULT 'ignore',
  "holidays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "notification" JSONB NOT NULL DEFAULT '{}',
  "last_checked_at" TIMESTAMP(3),
  "last_triggered_at" TIMESTAMP(3),
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "trigger_count" INTEGER NOT NULL DEFAULT 0,
  "last_status_code" INTEGER,
  "last_latency_ms" INTEGER,
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "cgi_monitor_rules_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "cgi_monitor_alerts" (
  "id" TEXT NOT NULL,
  "rule_id" TEXT NOT NULL,
  "alert_id" TEXT NOT NULL,
  "status_code" INTEGER,
  "latency_ms" INTEGER,
  "matched" BOOLEAN NOT NULL,
  "response_snippet" TEXT NOT NULL DEFAULT '',
  "error_message" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "cgi_monitor_alerts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "cgi_monitor_rules_enabled_idx" ON "cgi_monitor_rules"("enabled");
CREATE INDEX "cgi_monitor_rules_url_idx" ON "cgi_monitor_rules"("url");
CREATE INDEX "cgi_monitor_rules_last_checked_at_idx" ON "cgi_monitor_rules"("last_checked_at");
CREATE INDEX "cgi_monitor_rules_last_triggered_at_idx" ON "cgi_monitor_rules"("last_triggered_at");
CREATE INDEX "cgi_monitor_alerts_rule_id_created_at_idx" ON "cgi_monitor_alerts"("rule_id", "created_at");
CREATE INDEX "cgi_monitor_alerts_alert_id_idx" ON "cgi_monitor_alerts"("alert_id");

ALTER TABLE "cgi_monitor_alerts" ADD CONSTRAINT "cgi_monitor_alerts_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "cgi_monitor_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
