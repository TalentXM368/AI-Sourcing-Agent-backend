CREATE TABLE IF NOT EXISTS "gmail_resume_ingestion_events" (
  "organization_id" TEXT NOT NULL,
  "message_id" TEXT NOT NULL,
  "attachment_id" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "reason" TEXT,
  "cloudinary_public_id" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "gmail_resume_ingestion_events_status_check"
    CHECK ("status" IN ('UPLOADED', 'SKIPPED', 'FAILED'))
);

CREATE UNIQUE INDEX IF NOT EXISTS "gmail_resume_ingestion_events_attachment_key"
  ON "gmail_resume_ingestion_events" ("organization_id", "message_id", "attachment_id");

CREATE INDEX IF NOT EXISTS "gmail_resume_ingestion_events_created_at_idx"
  ON "gmail_resume_ingestion_events" ("organization_id", "created_at");
