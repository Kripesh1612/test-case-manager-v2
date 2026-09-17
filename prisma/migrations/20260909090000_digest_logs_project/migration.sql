-- Multi-tenant groundwork for the email digest (Feature 2):
-- digest_logs gains a project_id column so digests are scoped per project,
-- matching the pattern already applied to users/test_cases/test_suites/etc.

ALTER TABLE "digest_logs" ADD COLUMN "project_id" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "digest_logs_project_id_idx" ON "digest_logs"("project_id");

ALTER TABLE "digest_logs" ADD CONSTRAINT "digest_logs_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;