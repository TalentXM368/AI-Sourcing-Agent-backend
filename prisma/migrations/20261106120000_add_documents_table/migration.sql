-- Raw extracted resume/JD text, kept so parsing can be replayed without
-- re-downloading the source file. Mirrors backend/src/db/documents.ts.
CREATE TABLE IF NOT EXISTS "documents" (
  "id" VARCHAR PRIMARY KEY,
  "entity_type" VARCHAR NOT NULL,
  "entity_id" VARCHAR NOT NULL,
  "purpose" VARCHAR NOT NULL,
  "content" TEXT,
  "content_hash" VARCHAR,
  "mime_type" VARCHAR,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "documents_entity_type_entity_id_purpose_key" UNIQUE ("entity_type", "entity_id", "purpose")
);

CREATE INDEX IF NOT EXISTS "documents_entity_id_idx" ON "documents" ("entity_id");
