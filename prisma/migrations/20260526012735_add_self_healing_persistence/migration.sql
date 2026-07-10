-- CreateTable
CREATE TABLE "self_healing_rules" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "trigger_count" INTEGER NOT NULL DEFAULT 0,
    "success_rate" INTEGER NOT NULL DEFAULT 100,
    "last_executed_at" TEXT NOT NULL DEFAULT '尚未执行',
    "logic" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "notification" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "self_healing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_healing_executions" (
    "id" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "rule_name" TEXT NOT NULL,
    "service" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "triggered_at" TEXT NOT NULL,
    "trigger_value" TEXT NOT NULL,
    "duration" TEXT NOT NULL,
    "logs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_healing_executions_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "self_healing_executions" ADD CONSTRAINT "self_healing_executions_rule_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "self_healing_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
