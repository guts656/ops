ALTER TABLE "log_monitor_alerts"
ADD COLUMN "match_evidence" JSONB NOT NULL DEFAULT '[]';
