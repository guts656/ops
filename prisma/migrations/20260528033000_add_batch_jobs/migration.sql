-- CreateTable
CREATE TABLE "batch_jobs" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "target_directory" TEXT,
    "file_name" TEXT,
    "file_size" INTEGER,
    "script" TEXT,
    "params" JSONB,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_job_targets" (
    "id" TEXT NOT NULL,
    "job_id" TEXT NOT NULL,
    "host_id" TEXT NOT NULL,
    "host_ip" TEXT NOT NULL,
    "hostname" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "remote_path" TEXT,
    "exit_code" INTEGER,
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "summary" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "batch_job_targets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "batch_jobs_status_idx" ON "batch_jobs"("status");

-- CreateIndex
CREATE INDEX "batch_jobs_type_idx" ON "batch_jobs"("type");

-- CreateIndex
CREATE INDEX "batch_jobs_started_at_idx" ON "batch_jobs"("started_at");

-- CreateIndex
CREATE INDEX "batch_job_targets_job_id_idx" ON "batch_job_targets"("job_id");

-- CreateIndex
CREATE INDEX "batch_job_targets_host_id_idx" ON "batch_job_targets"("host_id");

-- CreateIndex
CREATE INDEX "batch_job_targets_status_idx" ON "batch_job_targets"("status");

-- AddForeignKey
ALTER TABLE "batch_job_targets" ADD CONSTRAINT "batch_job_targets_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "batch_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_job_targets" ADD CONSTRAINT "batch_job_targets_host_id_fkey" FOREIGN KEY ("host_id") REFERENCES "hosts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
