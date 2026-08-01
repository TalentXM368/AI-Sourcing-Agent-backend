-- Add ai_evaluations, pipeline_runs, processing_status tables
-- These are additive only — no existing data is modified

CREATE TABLE IF NOT EXISTS ai_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  match_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  display_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  confidence JSONB NOT NULL DEFAULT '{}',
  card_summary TEXT,
  detail_summary TEXT,
  reasoning JSONB,
  reranker_score DOUBLE PRECISION,
  provider TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(job_id, candidate_id)
);

CREATE INDEX IF NOT EXISTS idx_ai_evaluations_job_id ON ai_evaluations(job_id);
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_candidate_id ON ai_evaluations(candidate_id);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type TEXT NOT NULL,
  entity_id UUID,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  result JSONB,
  error TEXT,
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_type_status ON pipeline_runs(type, status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_entity_id ON pipeline_runs(entity_id);

CREATE TABLE IF NOT EXISTS processing_status (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  progress INTEGER NOT NULL DEFAULT 0,
  message TEXT,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW(),
  UNIQUE(entity_type, entity_id, stage)
);
