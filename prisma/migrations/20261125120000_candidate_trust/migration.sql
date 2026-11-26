-- Candidate Trust: Fake Candidate Check + Resume Check.
-- Rule-based signals for recruiter review. Signals are observations, never verdicts.
-- Only candidates a user chose (saved to a project, uploaded for checking, or checked
-- manually) are checked; every other candidate is used only as comparison data.

-- Comparison keys for every parsed candidate (email, phone, LinkedIn, GitHub,
-- resume-text hash, work-history hash, distinctive-line hashes). Lets one
-- candidate be checked against the whole database with indexed lookups.
CREATE TABLE IF NOT EXISTS candidate_fingerprints (
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  organization_id UUID,
  kind TEXT NOT NULL CHECK (kind IN ('email', 'phone', 'linkedin', 'github', 'text', 'work', 'line')),
  value TEXT NOT NULL,
  PRIMARY KEY (candidate_id, kind, value)
);

CREATE INDEX IF NOT EXISTS candidate_fingerprints_lookup_idx
  ON candidate_fingerprints(kind, value, organization_id);

-- When each candidate's fingerprints were last computed, to refresh only changed ones.
CREATE TABLE IF NOT EXISTS candidate_fingerprint_state (
  candidate_id UUID PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  source_updated_at TIMESTAMPTZ NOT NULL,
  fingerprinted_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS trust_runs (
  id UUID PRIMARY KEY,
  trigger TEXT NOT NULL CHECK (trigger IN ('saved', 'upload', 'manual', 'nightly')),
  sections TEXT[] NOT NULL DEFAULT '{fake,resume}',
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),
  rule_version TEXT NOT NULL,
  candidates_checked INTEGER NOT NULL DEFAULT 0,
  signals_found INTEGER NOT NULL DEFAULT 0,
  summary JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  started_by UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS trust_runs_started_idx ON trust_runs(started_at DESC);

-- The candidates users asked to check (the Trust Check queue), with open-signal counts.
CREATE TABLE IF NOT EXISTS trust_candidates (
  candidate_id UUID PRIMARY KEY REFERENCES candidates(id) ON DELETE CASCADE,
  organization_id UUID,
  first_trigger TEXT NOT NULL CHECK (first_trigger IN ('saved', 'upload', 'manual')),
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'checked', 'not_parsed', 'failed')),
  last_run_id UUID REFERENCES trust_runs(id) ON DELETE SET NULL,
  last_checked_at TIMESTAMPTZ,
  open_high INTEGER NOT NULL DEFAULT 0,
  open_medium INTEGER NOT NULL DEFAULT 0,
  open_low INTEGER NOT NULL DEFAULT 0,
  open_info INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS trust_candidates_queue_idx
  ON trust_candidates(organization_id, open_high DESC, open_medium DESC, last_checked_at DESC);

CREATE TABLE IF NOT EXISTS trust_signals (
  id UUID PRIMARY KEY,
  run_id UUID REFERENCES trust_runs(id) ON DELETE SET NULL,
  candidate_id UUID NOT NULL REFERENCES candidates(id) ON DELETE CASCADE,
  organization_id UUID,
  section TEXT NOT NULL CHECK (section IN ('fake', 'resume')),
  signal_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'low', 'medium', 'high')),
  engine TEXT NOT NULL DEFAULT 'rule' CHECK (engine IN ('rule', 'llm', 'jev')),
  rule_version TEXT,
  model_version TEXT,
  -- Stable identity of a finding, so re-runs update it instead of duplicating it
  -- and a recruiter's review survives re-runs.
  fingerprint TEXT NOT NULL,
  title TEXT NOT NULL,
  explanation TEXT NOT NULL,
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  related_candidate_ids UUID[] NOT NULL DEFAULT '{}',
  -- open: seen in the latest run. resolved: no longer found by the latest run.
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  review_status TEXT NOT NULL DEFAULT 'unreviewed'
    CHECK (review_status IN ('unreviewed', 'accepted', 'dismissed', 'false_positive', 'needs_info')),
  reviewer_id UUID REFERENCES users(id) ON DELETE SET NULL,
  review_notes TEXT,
  reviewed_at TIMESTAMPTZ,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (candidate_id, fingerprint)
);

CREATE INDEX IF NOT EXISTS trust_signals_candidate_idx ON trust_signals(candidate_id, status);
CREATE INDEX IF NOT EXISTS trust_signals_type_idx ON trust_signals(section, signal_type);
CREATE INDEX IF NOT EXISTS trust_signals_related_idx ON trust_signals USING GIN (related_candidate_ids);

-- Per-candidate checklist (every check, including passed / could-not-run) and how
-- many candidates the latest check compared against. Added 2026-11-25.
ALTER TABLE trust_candidates ADD COLUMN IF NOT EXISTS checklist JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE trust_candidates ADD COLUMN IF NOT EXISTS compared_against INTEGER;
