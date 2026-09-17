-- Add indexes that should have shipped with the original webhooks +
-- scheduled_jobs migration. Audit B5.
--
-- Background: the v1 webhooks migration added project_id NOT NULL
-- columns to webhooks and scheduled_jobs without the matching B-tree
-- indexes. Every list route (routes/webhooks.js GET /webhooks,
-- routes/scheduledJobs.js GET /scheduled-jobs) filters by project_id,
-- so without the index Postgres falls back to a sequential scan as
-- the table grows.
--
-- Also: the webhook deliveries endpoint orders by created_at DESC
-- within a single webhook. The original migration only added the
-- single-column (webhook_id) index — Postgres can filter with that,
-- but has to sort all matching rows in memory. A composite
-- (webhook_id, created_at DESC) matches the actual query exactly.
--
-- Finally: a unique constraint on (project_id, url) prevents duplicate
-- registrations of the same webhook URL within a single project, which
-- would otherwise double-fire every event to the same consumer.

-- CreateIndex: project_id FKs.
CREATE INDEX "webhooks_project_id_idx" ON "webhooks"("project_id");
CREATE INDEX "scheduled_jobs_project_id_idx" ON "scheduled_jobs"("project_id");

-- CreateIndex: composite for the deliveries list query.
CREATE INDEX "webhook_deliveries_webhook_id_created_at_idx"
  ON "webhook_deliveries"("webhook_id", "created_at" DESC);

-- CreateIndex: prevent duplicate webhook registrations.
-- (project_id, url) — same URL twice in the same project is almost
-- always a mistake, and a duplicate means every event fires twice.
-- NULL project_id is allowed because the column is NOT NULL with a
-- DEFAULT, so the unique constraint is effectively just (project_id, url).
CREATE UNIQUE INDEX "webhooks_project_id_url_key" ON "webhooks"("project_id", "url");
