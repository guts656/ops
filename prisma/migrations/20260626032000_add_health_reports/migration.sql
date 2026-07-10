CREATE TABLE "health_reports" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'weekly',
    "period_start" TIMESTAMP(3) NOT NULL,
    "period_end" TIMESTAMP(3) NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'completed',
    "health_score" INTEGER NOT NULL,
    "health_level" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "causes" JSONB NOT NULL DEFAULT '[]',
    "alert_summary" JSONB NOT NULL DEFAULT '{}',
    "sections" JSONB NOT NULL DEFAULT '[]',
    "suggestions" JSONB NOT NULL DEFAULT '[]',
    "source_snapshot" JSONB NOT NULL DEFAULT '{}',
    "generated_by" TEXT NOT NULL DEFAULT 'system',
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "health_reports_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "health_reports_type_period_start_period_end_key" ON "health_reports"("type", "period_start", "period_end");
CREATE INDEX "health_reports_type_generated_at_idx" ON "health_reports"("type", "generated_at");
CREATE INDEX "health_reports_period_start_period_end_idx" ON "health_reports"("period_start", "period_end");
CREATE INDEX "health_reports_health_level_idx" ON "health_reports"("health_level");
