CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  category TEXT NOT NULL,
  rule JSONB NOT NULL,
  priority INTEGER NOT NULL DEFAULT 50,
  confidence REAL NOT NULL DEFAULT 1.0,
  source TEXT NOT NULL,
  superseded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS preference_memories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  memory_text TEXT NOT NULL,
  embedding vector(1536),
  source TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  version TEXT NOT NULL,
  range_start TIMESTAMPTZ NOT NULL,
  range_end TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  base_snapshot_version TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  diff JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS calendar_commands (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  conversation_id UUID,
  idempotency_key TEXT NOT NULL UNIQUE,
  expected_snapshot_version TEXT NOT NULL,
  operation JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'proposed',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  executed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS agent_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  conversation_id UUID,
  action_type TEXT NOT NULL,
  proposed_payload JSONB,
  executed_payload JSONB,
  approval_status TEXT,
  provider_response JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
