-- Scope uploaded resumes and jobs to their authenticated creator.
ALTER TABLE "candidates"
  ADD COLUMN IF NOT EXISTS "organization_id" UUID,
  ADD COLUMN IF NOT EXISTS "created_by_id" UUID;

ALTER TABLE "jobs"
  ADD COLUMN IF NOT EXISTS "organization_id" UUID,
  ADD COLUMN IF NOT EXISTS "created_by_id" UUID;

CREATE INDEX IF NOT EXISTS "candidates_created_by_id_created_at_idx"
  ON "candidates"("created_by_id", "created_at");

CREATE INDEX IF NOT EXISTS "jobs_created_by_id_created_at_idx"
  ON "jobs"("created_by_id", "created_at");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidates_created_by_id_fkey'
  ) THEN
    ALTER TABLE "candidates"
      ADD CONSTRAINT "candidates_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'candidates_organization_id_fkey'
  ) THEN
    ALTER TABLE "candidates"
      ADD CONSTRAINT "candidates_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_created_by_id_fkey'
  ) THEN
    ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_created_by_id_fkey"
      FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'jobs_organization_id_fkey'
  ) THEN
    ALTER TABLE "jobs"
      ADD CONSTRAINT "jobs_organization_id_fkey"
      FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL;
  END IF;
END $$;
