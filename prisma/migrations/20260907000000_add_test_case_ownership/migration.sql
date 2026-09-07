-- Add editor-ownership to TestCase.
--
-- NULL is the default (legacy rows + any row created server-side
-- without an actor, e.g. fixture data) and is treated as "no recorded
-- owner" — admins can still mutate those rows; editors cannot.
-- See middleware/requireOwnership.js.

-- AlterTable
ALTER TABLE "test_cases" ADD COLUMN "created_by_id" INTEGER;

-- AddForeignKey
ALTER TABLE "test_cases" ADD CONSTRAINT "test_cases_created_by_id_fkey"
  FOREIGN KEY ("created_by_id") REFERENCES "users"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
