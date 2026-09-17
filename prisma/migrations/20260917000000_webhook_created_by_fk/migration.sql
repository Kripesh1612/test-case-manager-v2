-- Add a real FK from webhooks.created_by_id to users(id).
--
-- The original migration (20260909000000_add_projects_webhooks_digest_visual)
-- added `created_by_id INTEGER` without a FK constraint, so any integer
-- could be written there — including IDs of users that no longer exist.
-- Every other "created by" column in the schema (TestCase, Invite,
-- ScheduledJob, TestCaseVersion) has a real FK; this brings Webhook
-- into line.
--
-- ON DELETE SET NULL preserves the webhook row if its creator is
-- deleted — the audit trail says "created by an unknown user" rather
-- than cascading the delete (which would silently destroy the webhook
-- config when an admin is rotated out).
--
-- Existing rows: any webhooks.created_by_id pointing at a missing user
-- will be set to NULL by the FK enforcement. The original column was
-- nullable, so the backfill is a no-op for those rows.

ALTER TABLE "webhooks"
  ADD CONSTRAINT "webhooks_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
