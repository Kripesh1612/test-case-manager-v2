-- Add Project (multi-tenant), Webhook, WebhookDelivery, DigestLog models,
-- visual-regression screenshot columns on TestRun, and project_id scoping
-- on the existing domain tables.

-- CreateTable: projects
CREATE TABLE "projects" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable: digest_logs
CREATE TABLE "digest_logs" (
    "id" SERIAL NOT NULL,
    "sent_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recipients" JSONB NOT NULL,
    "summary" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "digest_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: webhooks
CREATE TABLE "webhooks" (
    "id" SERIAL NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL DEFAULT '',
    "event" TEXT NOT NULL DEFAULT 'suite.run.completed',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "project_id" INTEGER NOT NULL DEFAULT 1,
    "created_by_id" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: webhook_deliveries
CREATE TABLE "webhook_deliveries" (
    "id" SERIAL NOT NULL,
    "webhook_id" INTEGER NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status_code" INTEGER,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);

-- AlterTable — scope existing domain tables with a default project.
ALTER TABLE "test_cases" ADD COLUMN     "project_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "test_suites" ADD COLUMN     "project_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "users" ADD COLUMN     "project_id" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "scheduled_jobs" ADD COLUMN     "project_id" INTEGER NOT NULL DEFAULT 1;

-- Visual regression columns on TestRun
ALTER TABLE "test_runs" ADD COLUMN     "diff_image" TEXT,
ADD COLUMN     "diff_score" DOUBLE PRECISION,
ADD COLUMN     "screenshot_after" TEXT,
ADD COLUMN     "screenshot_before" TEXT;

-- CreateIndex — unique index MUST exist before the seed insert below so
-- ON CONFLICT (slug) has an arbiter to reference.
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");
CREATE INDEX "webhook_deliveries_webhook_id_idx" ON "webhook_deliveries"("webhook_id");

-- Seed the default project so the `DEFAULT 1` project_id columns resolve.
INSERT INTO "projects" ("name", "slug", "updated_at")
VALUES ('Default', 'default', CURRENT_TIMESTAMP)
ON CONFLICT ("slug") DO NOTHING;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhooks" ADD CONSTRAINT "webhooks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "webhooks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "test_suites" ADD CONSTRAINT "test_suites_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "users" ADD CONSTRAINT "users_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "scheduled_jobs" ADD CONSTRAINT "scheduled_jobs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
