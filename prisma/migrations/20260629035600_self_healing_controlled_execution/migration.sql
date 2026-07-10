-- Add controlled automatic execution switches to self-healing rules.
ALTER TABLE "self_healing_rules"
ADD COLUMN IF NOT EXISTS "auto_execute" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "execution_mode" TEXT NOT NULL DEFAULT 'safe';

-- Add execution metadata for safe-mode plans and controlled action results.
ALTER TABLE "self_healing_executions"
ADD COLUMN IF NOT EXISTS "mode" TEXT NOT NULL DEFAULT 'safe',
ADD COLUMN IF NOT EXISTS "action_results" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN IF NOT EXISTS "agent_job_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
