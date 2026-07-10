-- AlterTable
ALTER TABLE "host_resource_points" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sampled_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "hosts" ADD COLUMN     "agent_token_hash" TEXT,
ADD COLUMN     "agent_token_version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "last_metric_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "host_resource_points_host_id_sampled_at_idx" ON "host_resource_points"("host_id", "sampled_at");
