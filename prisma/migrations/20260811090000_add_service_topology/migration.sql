CREATE TABLE "topology_nodes" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT '稳定',
  "description" TEXT NOT NULL DEFAULT '',
  "x" INTEGER NOT NULL DEFAULT 80,
  "y" INTEGER NOT NULL DEFAULT 80,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "topology_nodes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "topology_edges" (
  "id" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "topology_edges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "topology_nodes_type_idx" ON "topology_nodes"("type");
CREATE INDEX "topology_nodes_status_idx" ON "topology_nodes"("status");
CREATE INDEX "topology_edges_source_id_idx" ON "topology_edges"("source_id");
CREATE INDEX "topology_edges_target_id_idx" ON "topology_edges"("target_id");

ALTER TABLE "topology_edges" ADD CONSTRAINT "topology_edges_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "topology_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "topology_edges" ADD CONSTRAINT "topology_edges_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "topology_nodes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "topology_nodes" ("id", "name", "type", "status", "description", "x", "y", "updated_at") VALUES
  ('business', '核心业务入口', 'business', '稳定', '用户门户、API 调用与管理端统一入口', 80, 88, CURRENT_TIMESTAMP),
  ('gateway', '网关 / 负载均衡', 'middleware', '稳定', 'HTTPS 接入、路由转发、限流与健康检查', 300, 88, CURRENT_TIMESTAMP),
  ('ops-app', '运维平台应用', 'service', '重点', '告警、主机、日志、自愈、批处理等平台能力', 535, 88, CURRENT_TIMESTAMP),
  ('agent-hosts', '纳管主机集群', 'host', '稳定', 'Windows / Linux 主机与 Agent 采集端', 300, 285, CURRENT_TIMESTAMP),
  ('observability', '监控与日志链路', 'service', '稳定', '指标、日志、事件、通知与周报生成', 535, 285, CURRENT_TIMESTAMP),
  ('postgres', 'PostgreSQL', 'database', '核心', '业务数据、审计数据、配置与执行记录', 760, 188, CURRENT_TIMESTAMP),
  ('static-note', '静态说明', 'note', '可维护', '该拓扑已支持手动维护节点、依赖线和拖拽布局。', 80, 320, CURRENT_TIMESTAMP);

INSERT INTO "topology_edges" ("id", "source_id", "target_id", "label", "updated_at") VALUES
  ('e1', 'business', 'gateway', 'HTTPS', CURRENT_TIMESTAMP),
  ('e2', 'gateway', 'ops-app', 'API 路由', CURRENT_TIMESTAMP),
  ('e3', 'ops-app', 'postgres', '读写数据', CURRENT_TIMESTAMP),
  ('e4', 'agent-hosts', 'observability', '采集上报', CURRENT_TIMESTAMP),
  ('e5', 'observability', 'ops-app', '告警 / 周报', CURRENT_TIMESTAMP),
  ('e6', 'observability', 'postgres', '留痕存储', CURRENT_TIMESTAMP);
