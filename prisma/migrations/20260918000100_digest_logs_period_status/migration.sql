-- Add status / error / period columns to digest_logs (audit B6).
--
-- The original digest_logs row stored status info inside the JSONB
-- `summary` column, which made it unqueryable in SQL: "show me all
-- failed digests for project X over the last 30 days" required an
-- index scan + JSONB filter. After this migration, status and the
-- period_start/period_end bounds are first-class columns with proper
-- indexes.
--
-- The new columns are nullable + DEFAULT so the migration is safe to
-- run on existing rows. New rows get them populated by sendDigest
-- (utils/digest.js).
--
-- Backfill: there is nothing to backfill — every existing digest_logs
-- row is by definition a 'sent' row (the old code only persisted on
-- successful delivery, and the period bounds were not stored at all).

-- AlterTable
ALTER TABLE "digest_logs"
  ADD COLUMN "status"     TEXT NOT NULL DEFAULT 'sent',
  ADD COLUMN "error"      TEXT,
  ADD COLUMN "period_start" TIMESTAMP(3),
  ADD COLUMN "period_end"   TIMESTAMP(3);

-- CreateIndex: separate indexes for status / per-project timeline queries.
CREATE INDEX "digest_logs_status_idx" ON "digest_logs"("status");
CREATE INDEX "digest_logs_project_id_sent_at_idx" ON "digest_logs"("project_id", "sent_at" DESC);
