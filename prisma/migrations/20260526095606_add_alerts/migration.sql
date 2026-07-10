-- CreateTable
CREATE TABLE "alerts" (
    "id" TEXT NOT NULL,
    "level" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "diagnosis" TEXT,
    "acknowledged_at" TEXT,
    "resolved_at" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "alerts_level_idx" ON "alerts"("level");

-- CreateIndex
CREATE INDEX "alerts_service_idx" ON "alerts"("service");

-- CreateIndex
CREATE INDEX "alerts_status_idx" ON "alerts"("status");
