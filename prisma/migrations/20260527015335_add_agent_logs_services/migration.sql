-- AlterTable
ALTER TABLE "app_logs" ADD COLUMN     "host_id" TEXT,
ADD COLUMN     "ingested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "labels" JSONB,
ADD COLUMN     "raw_payload" JSONB,
ADD COLUMN     "source" TEXT;

-- CreateTable
CREATE TABLE "host_services" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "port" INTEGER,
    "protocol" TEXT,
    "version" TEXT,
    "pid" INTEGER,
    "source" TEXT NOT NULL,
    "metadata" JSONB,
    "last_reported_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_services_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_events" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "occurred_at" TIMESTAMP(3) NOT NULL,
    "source" TEXT NOT NULL,
    "payload" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_services_host_id_last_reported_at_idx" ON "host_services"("host_id", "last_reported_at");

-- CreateIndex
CREATE INDEX "host_services_name_idx" ON "host_services"("name");

-- CreateIndex
CREATE INDEX "host_services_status_idx" ON "host_services"("status");

-- CreateIndex
CREATE UNIQUE INDEX "host_services_host_id_name_port_key" ON "host_services"("host_id", "name", "port");

-- CreateIndex
CREATE INDEX "service_events_host_id_occurred_at_idx" ON "service_events"("host_id", "occurred_at");

-- CreateIndex
CREATE INDEX "service_events_service_occurred_at_idx" ON "service_events"("service", "occurred_at");

-- CreateIndex
CREATE INDEX "service_events_level_occurred_at_idx" ON "service_events"("level", "occurred_at");

-- CreateIndex
CREATE INDEX "app_logs_host_id_timestamp_idx" ON "app_logs"("host_id", "timestamp");

-- CreateIndex
CREATE INDEX "app_logs_source_timestamp_idx" ON "app_logs"("source", "timestamp");

-- AddForeignKey
ALTER TABLE "host_services" ADD CONSTRAINT "host_services_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_events" ADD CONSTRAINT "service_events_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
