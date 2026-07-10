ALTER TABLE "cgi_monitor_rules"
ADD COLUMN IF NOT EXISTS "self_healing_binding" JSONB,
ADD COLUMN IF NOT EXISTS "generated_self_healing_rule_id" TEXT,
ADD COLUMN IF NOT EXISTS "generated_alert_handling_rule_id" TEXT;

CREATE INDEX IF NOT EXISTS "cgi_monitor_rules_generated_self_healing_rule_id_idx" ON "cgi_monitor_rules"("generated_self_healing_rule_id");
CREATE INDEX IF NOT EXISTS "cgi_monitor_rules_generated_alert_handling_rule_id_idx" ON "cgi_monitor_rules"("generated_alert_handling_rule_id");
