-- Performance indexes for candidate filtering and sorting
-- These support the advanced search page's filter and facet queries

-- Location filtering (ILIKE '%term%' and exact match)
CREATE INDEX IF NOT EXISTS idx_candidates_location ON candidates USING gin (location gin_trgm_ops);

-- Source filtering (exact match, used in search-all and facets)
CREATE INDEX IF NOT EXISTS idx_candidates_source ON candidates (source);

-- Stage filtering (exact match, used in pipeline views)
CREATE INDEX IF NOT EXISTS idx_candidates_stage ON candidates (stage);

-- Data quality score (range queries, sorting)
CREATE INDEX IF NOT EXISTS idx_candidates_data_quality_score ON candidates (data_quality_score);

-- Experience years (range queries, sorting)
CREATE INDEX IF NOT EXISTS idx_candidates_experience_years ON candidates (experience_years);

-- Created at (sorting, date range queries)
CREATE INDEX IF NOT EXISTS idx_candidates_created_at ON candidates (created_at DESC);

-- Name (autocomplete, ILIKE)
CREATE INDEX IF NOT EXISTS idx_candidates_name ON candidates USING gin (name gin_trgm_ops);

-- Composite indexes for common filter combinations
CREATE INDEX IF NOT EXISTS idx_candidates_source_stage ON candidates (source, stage);
CREATE INDEX IF NOT EXISTS idx_candidates_source_created ON candidates (source, created_at DESC);
