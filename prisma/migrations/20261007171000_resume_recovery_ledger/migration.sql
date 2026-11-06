CREATE TABLE IF NOT EXISTS resume_recovery_batches (
  id UUID PRIMARY KEY,
  stage TEXT NOT NULL CHECK (stage IN ('20', '100', '300', 'remaining')),
  status TEXT NOT NULL CHECK (status IN ('running', 'review_required', 'approved', 'stopped', 'completed', 'failed')),
  concurrency INTEGER NOT NULL CHECK (concurrency BETWEEN 1 AND 5),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  review_notes TEXT,
  reviewed_resume_ids UUID[] NOT NULL DEFAULT '{}',
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS resume_recovery_batches_status_idx
  ON resume_recovery_batches(status, created_at DESC);

CREATE TABLE IF NOT EXISTS resume_parse_runs (
  id UUID PRIMARY KEY,
  batch_id UUID NOT NULL REFERENCES resume_recovery_batches(id) ON DELETE CASCADE,
  resume_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  parser_version TEXT NOT NULL,
  file_hash TEXT,
  status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'success', 'partial', 'low_quality', 'failed', 'skipped')),
  extraction_method TEXT,
  llm_calls INTEGER NOT NULL DEFAULT 0,
  quality_score INTEGER CHECK (quality_score BETWEEN 0 AND 100),
  old_quality_score INTEGER,
  old_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_profile JSONB,
  comparison JSONB NOT NULL DEFAULT '{}'::jsonb,
  provenance JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_code TEXT,
  error_message TEXT,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  last_parser_method TEXT,
  recommended_next_action TEXT,
  index_status TEXT NOT NULL DEFAULT 'not_eligible'
    CHECK (index_status IN ('not_eligible', 'replacement_required', 'indexed', 'failed')),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(batch_id, resume_id)
);

CREATE INDEX IF NOT EXISTS resume_parse_runs_batch_status_idx
  ON resume_parse_runs(batch_id, status, created_at);

CREATE INDEX IF NOT EXISTS resume_parse_runs_resume_version_idx
  ON resume_parse_runs(resume_id, parser_version, file_hash, status);
