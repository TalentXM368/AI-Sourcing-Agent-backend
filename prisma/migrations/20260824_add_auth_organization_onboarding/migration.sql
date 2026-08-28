-- Add V1 authentication and organization onboarding tables.
-- Existing sourcing data is intentionally untouched and remains shared baseline data.

CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "OrganizationMemberRole" AS ENUM ('OWNER', 'ADMIN', 'RECRUITER', 'HIRING_MANAGER', 'MEMBER');
CREATE TYPE "OrganizationMemberStatus" AS ENUM ('ACTIVE', 'INVITED', 'REMOVED');

CREATE TABLE "users" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "first_name" TEXT NOT NULL,
  "last_name" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "onboarding_role" TEXT,
  "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "last_login_at" TIMESTAMP,
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");

CREATE TABLE "organizations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "name" TEXT NOT NULL,
  "website" TEXT,
  "industry" TEXT,
  "company_size" TEXT,
  "country" TEXT,
  "logo_url" TEXT,
  "onboarding_completed" BOOLEAN NOT NULL DEFAULT false,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "organizations_name_idx" ON "organizations"("name");

CREATE TABLE "organization_members" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "user_id" UUID NOT NULL,
  "role" "OrganizationMemberRole" NOT NULL,
  "status" "OrganizationMemberStatus" NOT NULL DEFAULT 'ACTIVE',
  "joined_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "organization_members_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_members_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "organization_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "organization_members_organization_id_user_id_key" ON "organization_members"("organization_id", "user_id");
CREATE INDEX "organization_members_user_id_status_idx" ON "organization_members"("user_id", "status");
CREATE INDEX "organization_members_organization_id_role_status_idx" ON "organization_members"("organization_id", "role", "status");

CREATE TABLE "sessions" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "last_used_at" TIMESTAMP,
  CONSTRAINT "sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_expires_at_idx" ON "sessions"("user_id", "expires_at");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

CREATE TABLE "password_reset_tokens" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "user_id" UUID NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "used_at" TIMESTAMP,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");
CREATE INDEX "password_reset_tokens_user_id_expires_at_idx" ON "password_reset_tokens"("user_id", "expires_at");

CREATE TABLE "organization_invitations" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organization_id" UUID NOT NULL,
  "email" TEXT NOT NULL,
  "role" "OrganizationMemberRole" NOT NULL,
  "token_hash" TEXT NOT NULL,
  "expires_at" TIMESTAMP NOT NULL,
  "accepted_at" TIMESTAMP,
  "created_by_id" UUID NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE,
  CONSTRAINT "organization_invitations_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT
);
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");
CREATE INDEX "organization_invitations_organization_id_email_idx" ON "organization_invitations"("organization_id", "email");
CREATE INDEX "organization_invitations_email_expires_at_idx" ON "organization_invitations"("email", "expires_at");
