INSERT INTO "topologies" ("id", "name", "type", "remark", "created_at", "updated_at")
SELECT 'default-service-topology', '默认服务拓扑', '业务拓扑', '现有拓扑节点和依赖线的默认归属拓扑', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "topologies" WHERE "id" = 'default-service-topology');

ALTER TABLE "topology_nodes" ADD COLUMN "topology_id" TEXT;
UPDATE "topology_nodes" SET "topology_id" = 'default-service-topology' WHERE "topology_id" IS NULL;
ALTER TABLE "topology_nodes" ALTER COLUMN "topology_id" SET NOT NULL;

ALTER TABLE "topology_edges" ADD COLUMN "topology_id" TEXT;
UPDATE "topology_edges" SET "topology_id" = (
  SELECT "topology_nodes"."topology_id"
  FROM "topology_nodes"
  WHERE "topology_nodes"."id" = "topology_edges"."source_id"
) WHERE "topology_id" IS NULL;
UPDATE "topology_edges" SET "topology_id" = 'default-service-topology' WHERE "topology_id" IS NULL;
ALTER TABLE "topology_edges" ALTER COLUMN "topology_id" SET NOT NULL;

CREATE INDEX "topology_nodes_topology_id_idx" ON "topology_nodes"("topology_id");
CREATE INDEX "topology_edges_topology_id_idx" ON "topology_edges"("topology_id");

ALTER TABLE "topology_nodes" ADD CONSTRAINT "topology_nodes_topology_id_fkey" FOREIGN KEY ("topology_id") REFERENCES "topologies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "topology_edges" ADD CONSTRAINT "topology_edges_topology_id_fkey" FOREIGN KEY ("topology_id") REFERENCES "topologies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
