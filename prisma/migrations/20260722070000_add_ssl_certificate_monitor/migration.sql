-- CreateTable
CREATE TABLE "ssl_certificate_monitors" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "domain" TEXT NOT NULL,
    "server_ip" TEXT,
    "port" INTEGER NOT NULL DEFAULT 443,
    "issuer" TEXT NOT NULL DEFAULT '',
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "remaining_days" INTEGER,
    "domain_matched" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "thresholds" INTEGER[] DEFAULT ARRAY[30, 15, 7]::INTEGER[],
    "check_time" TEXT NOT NULL DEFAULT '08:30',
    "alert_level" TEXT NOT NULL DEFAULT '警告',
    "notification" JSONB NOT NULL DEFAULT '{}',
    "last_checked_at" TIMESTAMP(3),
    "next_check_at" TIMESTAMP(3),
    "last_triggered_at" TIMESTAMP(3),
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ssl_certificate_monitors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ssl_certificate_histories" (
    "id" TEXT NOT NULL,
    "monitor_id" TEXT NOT NULL,
    "alert_id" TEXT,
    "domain" TEXT NOT NULL,
    "server_ip" TEXT,
    "port" INTEGER NOT NULL,
    "checked_at" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL,
    "issuer" TEXT NOT NULL DEFAULT '',
    "valid_from" TIMESTAMP(3),
    "valid_to" TIMESTAMP(3),
    "remaining_days" INTEGER,
    "domain_matched" BOOLEAN NOT NULL,
    "alert_level" TEXT NOT NULL,
    "matched_threshold" INTEGER,
    "notification_results" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ssl_certificate_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ssl_certificate_monitors_enabled_idx" ON "ssl_certificate_monitors"("enabled");

-- CreateIndex
CREATE INDEX "ssl_certificate_monitors_domain_idx" ON "ssl_certificate_monitors"("domain");

-- CreateIndex
CREATE INDEX "ssl_certificate_monitors_status_idx" ON "ssl_certificate_monitors"("status");

-- CreateIndex
CREATE INDEX "ssl_certificate_monitors_next_check_at_idx" ON "ssl_certificate_monitors"("next_check_at");

-- CreateIndex
CREATE INDEX "ssl_certificate_monitors_last_checked_at_idx" ON "ssl_certificate_monitors"("last_checked_at");

-- CreateIndex
CREATE INDEX "ssl_certificate_histories_monitor_id_checked_at_idx" ON "ssl_certificate_histories"("monitor_id", "checked_at");

-- CreateIndex
CREATE INDEX "ssl_certificate_histories_alert_id_idx" ON "ssl_certificate_histories"("alert_id");

-- CreateIndex
CREATE INDEX "ssl_certificate_histories_status_idx" ON "ssl_certificate_histories"("status");

-- AddForeignKey
ALTER TABLE "ssl_certificate_histories" ADD CONSTRAINT "ssl_certificate_histories_monitor_id_fkey" FOREIGN KEY ("monitor_id") REFERENCES "ssl_certificate_monitors"("id") ON DELETE CASCADE ON UPDATE CASCADE;
