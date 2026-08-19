ALTER TABLE "topologies" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'structured';
ALTER TABLE "topologies" ADD COLUMN "canvas_data" JSONB NOT NULL DEFAULT '{}';

CREATE INDEX "topologies_mode_idx" ON "topologies"("mode");
