-- Add performance indexes for production readiness
-- Run: psql $DATABASE_URL -f backend/prisma/add-indexes.sql

-- candidates: most-filtered column
CREATE INDEX IF NOT EXISTS idx_candidates_parse_status ON candidates(parse_status);

-- candidates: filter columns
CREATE INDEX IF NOT EXISTS idx_candidates_industry ON candidates(industry);
CREATE INDEX IF NOT EXISTS idx_candidates_region ON candidates(region);

-- jobs: scoring filter
CREATE INDEX IF NOT EXISTS idx_jobs_status ON jobs(status);

-- jobs: FK index
CREATE INDEX IF NOT EXISTS idx_jobs_client_id ON jobs(client_id);

-- jobs: filter columns
CREATE INDEX IF NOT EXISTS idx_jobs_industry ON jobs(industry);
CREATE INDEX IF NOT EXISTS idx_jobs_region ON jobs(region);

-- grouped counts used by jobs and health endpoints
CREATE INDEX IF NOT EXISTS idx_ranked_candidates_job_id_score ON ranked_candidates(job_id, total_score DESC);
CREATE INDEX IF NOT EXISTS idx_ai_evaluations_job_id ON ai_evaluations(job_id);
