-- CreateTable
CREATE TABLE "test_case_versions" (
    "id" SERIAL NOT NULL,
    "case_id" INTEGER NOT NULL,
    "version" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" INTEGER,

    CONSTRAINT "test_case_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "test_case_versions_case_id_version_idx" ON "test_case_versions"("case_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "test_case_versions_case_id_version_key" ON "test_case_versions"("case_id", "version");

-- AddForeignKey
ALTER TABLE "test_case_versions" ADD CONSTRAINT "test_case_versions_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "test_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
