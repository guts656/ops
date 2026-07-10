-- CreateTable
CREATE TABLE "slow_queries" (
    "id" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "database" TEXT NOT NULL,
    "schema" TEXT NOT NULL,
    "application" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "sql_fingerprint" TEXT NOT NULL,
    "raw_sql" TEXT NOT NULL,
    "masked_sql" TEXT NOT NULL,
    "execution_time" INTEGER NOT NULL,
    "scanned_rows" INTEGER NOT NULL,
    "affected_rows" INTEGER NOT NULL,
    "frequency" INTEGER NOT NULL,
    "risk_level" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "risk_score" INTEGER NOT NULL,
    "plan" JSONB NOT NULL,
    "suggestions" JSONB NOT NULL,
    "trend" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slow_queries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slow_query_work_orders" (
    "id" TEXT NOT NULL,
    "query_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "database" TEXT NOT NULL,
    "change_content" TEXT NOT NULL,
    "pre_assessment" TEXT NOT NULL,
    "rollback_plan" TEXT NOT NULL,
    "approvals" JSONB NOT NULL,
    "status" TEXT NOT NULL,
    "execution_records" JSONB NOT NULL,
    "post_evaluation" TEXT,
    "created_at_text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slow_query_work_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slow_query_audit_logs" (
    "id" TEXT NOT NULL,
    "time" TEXT NOT NULL,
    "operator" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "previous_hash" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "retention_until" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "slow_query_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "slow_queries_database_idx" ON "slow_queries"("database");

-- CreateIndex
CREATE INDEX "slow_queries_risk_level_idx" ON "slow_queries"("risk_level");

-- CreateIndex
CREATE INDEX "slow_queries_status_idx" ON "slow_queries"("status");

-- CreateIndex
CREATE INDEX "slow_query_work_orders_query_id_idx" ON "slow_query_work_orders"("query_id");

-- CreateIndex
CREATE INDEX "slow_query_work_orders_status_idx" ON "slow_query_work_orders"("status");

-- AddForeignKey
ALTER TABLE "slow_query_work_orders" ADD CONSTRAINT "slow_query_work_orders_query_id_fkey" FOREIGN KEY ("query_id") REFERENCES "slow_queries"("id") ON DELETE CASCADE ON UPDATE CASCADE;
