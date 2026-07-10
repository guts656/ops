-- CreateTable
CREATE TABLE "host_agent_jobs" (
    "id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "summary" TEXT NOT NULL,
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "host_agent_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "host_agent_jobs_host_id_idx" ON "host_agent_jobs"("host_id");

-- CreateIndex
CREATE INDEX "host_agent_jobs_status_idx" ON "host_agent_jobs"("status");

-- AddForeignKey
ALTER TABLE "host_agent_jobs" ADD CONSTRAINT "host_agent_jobs_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
