CREATE TABLE "topologies" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "remark" TEXT NOT NULL DEFAULT '',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "topologies_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "topologies_type_idx" ON "topologies"("type");
