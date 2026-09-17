-- AddForeignKey. Feature 4: invites + audit events live inside a project so
-- project-scoped admin surfaces (invite list, audit log, project switcher)
-- can filter rows by the caller's project id.
ALTER TABLE "invites" ADD COLUMN "project_id" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "invites_project_id_idx" ON "invites"("project_id");
ALTER TABLE "invites" ADD CONSTRAINT "invites_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "audit_events" ADD COLUMN "project_id" INTEGER NOT NULL DEFAULT 1;
CREATE INDEX "audit_events_project_id_idx" ON "audit_events"("project_id");
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_project_id_fkey"
  FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;