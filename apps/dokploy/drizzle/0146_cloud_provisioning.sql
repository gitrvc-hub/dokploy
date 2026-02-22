-- Cloud provisioning: new enums, cloud_provider table, and server table extensions
-- Migration: 0146_cloud_provisioning

DO $$ BEGIN
  CREATE TYPE "public"."cloudProviderType" AS ENUM('hetzner', 'digitalocean', 'custom');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."provisionStatus" AS ENUM('pending', 'provisioning', 'provisioned', 'failed', 'destroying', 'destroyed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "public"."serverRole" AS ENUM('master', 'worker');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Cloud provider credentials table
CREATE TABLE IF NOT EXISTS "cloud_provider" (
  "cloudProviderId" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "providerType" "cloudProviderType" NOT NULL,
  "encryptedApiToken" text NOT NULL DEFAULT '',
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" text NOT NULL,
  "organizationId" text NOT NULL
);

DO $$ BEGIN
  ALTER TABLE "cloud_provider"
    ADD CONSTRAINT "cloud_provider_organizationId_organization_id_fk"
    FOREIGN KEY ("organizationId") REFERENCES "public"."organization"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Provisioner job tables (used by Go service, written by Go, read by Node.js for status)
CREATE TABLE IF NOT EXISTS "provisioner_job" (
  "jobId" text PRIMARY KEY NOT NULL,
  "jobType" text NOT NULL,
  "serverId" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "createdAt" timestamptz NOT NULL DEFAULT NOW(),
  "updatedAt" timestamptz
);

CREATE TABLE IF NOT EXISTS "provisioner_job_log" (
  "id" bigserial PRIMARY KEY,
  "jobId" text NOT NULL,
  "line" text NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS "provisioner_job_log_jobId_idx" ON "provisioner_job_log" ("jobId");

-- Extend server table with cloud provisioning columns
ALTER TABLE "server"
  ADD COLUMN IF NOT EXISTS "cloudProviderId" text,
  ADD COLUMN IF NOT EXISTS "region" text,
  ADD COLUMN IF NOT EXISTS "serverSize" text,
  ADD COLUMN IF NOT EXISTS "osImage" text,
  ADD COLUMN IF NOT EXISTS "isBYOS" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "provisionStatus" "provisionStatus" DEFAULT 'provisioned',
  ADD COLUMN IF NOT EXISTS "providerServerId" text,
  ADD COLUMN IF NOT EXISTS "hostKeyFingerprint" text,
  ADD COLUMN IF NOT EXISTS "encryptedKubeconfig" text,
  ADD COLUMN IF NOT EXISTS "encryptedK3sToken" text,
  ADD COLUMN IF NOT EXISTS "k3sInstalled" boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "serverRole" "serverRole" DEFAULT 'master',
  ADD COLUMN IF NOT EXISTS "masterServerId" text;

DO $$ BEGIN
  ALTER TABLE "server"
    ADD CONSTRAINT "server_cloudProviderId_cloud_provider_fk"
    FOREIGN KEY ("cloudProviderId") REFERENCES "public"."cloud_provider"("cloudProviderId") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  ALTER TABLE "server"
    ADD CONSTRAINT "server_masterServerId_server_fk"
    FOREIGN KEY ("masterServerId") REFERENCES "public"."server"("serverId") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
