-- CreateTable
CREATE TABLE "app_logs" (
    "id" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "service" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "trace_id" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "app_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "app_logs_timestamp_idx" ON "app_logs"("timestamp");

-- CreateIndex
CREATE INDEX "app_logs_service_timestamp_idx" ON "app_logs"("service", "timestamp");

-- CreateIndex
CREATE INDEX "app_logs_level_timestamp_idx" ON "app_logs"("level", "timestamp");

-- CreateIndex
CREATE INDEX "app_logs_trace_id_idx" ON "app_logs"("trace_id");
