-- AlterTable
ALTER TABLE "test_cases" ADD COLUMN     "executable_snippet" TEXT;

-- AlterTable
ALTER TABLE "test_runs" ADD COLUMN     "assertion_count" INTEGER,
ADD COLUMN     "error_log" TEXT,
ADD COLUMN     "exit_code" INTEGER,
ADD COLUMN     "started_via" TEXT DEFAULT 'manual';
