-- CreateTable
CREATE TABLE "log_monitor_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "service" TEXT,
    "level" TEXT,
    "host_id" TEXT,
    "source" TEXT,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "threshold" INTEGER NOT NULL,
    "window_minutes" INTEGER NOT NULL,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
    "alert_level" TEXT NOT NULL DEFAULT '警告',
    "days_of_week" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "time_ranges" JSONB NOT NULL DEFAULT '[]',
    "holiday_mode" TEXT NOT NULL DEFAULT 'ignore',
    "holidays" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notification" JSONB NOT NULL DEFAULT '{}',
    "last_evaluated_at" TIMESTAMP(3),
    "last_triggered_at" TIMESTAMP(3),
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "log_monitor_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "log_monitor_alerts" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "alert_id" TEXT NOT NULL,
    "matched_count" INTEGER NOT NULL,
    "window_start" TIMESTAMP(3) NOT NULL,
    "window_end" TIMESTAMP(3) NOT NULL,
    "matched_keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sample_log_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notification_results" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "log_monitor_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "log_monitor_rules_enabled_idx" ON "log_monitor_rules"("enabled");

-- CreateIndex
CREATE INDEX "log_monitor_rules_service_idx" ON "log_monitor_rules"("service");

-- CreateIndex
CREATE INDEX "log_monitor_rules_level_idx" ON "log_monitor_rules"("level");

-- CreateIndex
CREATE INDEX "log_monitor_rules_host_id_idx" ON "log_monitor_rules"("host_id");

-- CreateIndex
CREATE INDEX "log_monitor_rules_last_triggered_at_idx" ON "log_monitor_rules"("last_triggered_at");

-- CreateIndex
CREATE INDEX "log_monitor_alerts_rule_id_created_at_idx" ON "log_monitor_alerts"("rule_id", "created_at");

-- CreateIndex
CREATE INDEX "log_monitor_alerts_alert_id_idx" ON "log_monitor_alerts"("alert_id");

-- AddForeignKey
ALTER TABLE "log_monitor_alerts" ADD CONSTRAINT "log_monitor_alerts_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "log_monitor_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
