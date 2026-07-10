ALTER TABLE "cgi_monitor_rules" ADD COLUMN "probe_host_id" TEXT;

CREATE INDEX "cgi_monitor_rules_probe_host_id_idx" ON "cgi_monitor_rules"("probe_host_id");

ALTER TABLE "cgi_monitor_rules" ADD CONSTRAINT "cgi_monitor_rules_probe_host_id_fkey" FOREIGN KEY ("probe_host_id") REFERENCES "hosts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
