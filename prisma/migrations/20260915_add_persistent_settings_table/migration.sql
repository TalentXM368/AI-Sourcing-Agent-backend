-- Persist organization settings and encrypted provider API keys.
CREATE TABLE IF NOT EXISTS "settings" (
  "key" TEXT PRIMARY KEY,
  "value" JSONB NOT NULL DEFAULT 'true'::jsonb,
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "settings_updated_at_idx"
  ON "settings"("updated_at");

INSERT INTO "settings" ("key", "value")
VALUES
  ('auto_sync_resumes', 'true'::jsonb),
  ('auto_sync_jds', 'false'::jsonb)
ON CONFLICT ("key") DO NOTHING;
