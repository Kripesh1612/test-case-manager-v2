// Snapshots — append a TestCaseVersion row capturing a test case's
// current user-editable fields.
//
// Called from routes/testCases.js on every create + every update, and
// from routes/versions.js after a restore. The version number is
// monotonic per case_id (1, 2, 3, ...) and the table has a unique
// constraint on (case_id, version) — so concurrent snapshots for the
// same case can race but the second one will fail loudly with a
// Prisma P2002 error.
//
// Snapshot shape matches caseSnapshotSchema in shared/schemas/.

const prisma = require('../db');

// Fields we snapshot. Keep this list in sync with the shared Zod schema
// (caseSnapshotSchema) — anything versioned lives here.
const VERSIONED_FIELDS = [
  'title',
  'description',
  'steps',
  'expected_result',
  'priority',
  'status',
  'tags',
];

// Pick just the versioned fields off a TestCase row.
function toSnapshot(tc) {
  const snap = {};
  for (const f of VERSIONED_FIELDS) {
    snap[f] = tc[f] ?? (Array.isArray(tc[f]) ? [] : '');
  }
  return snap;
}

// Atomic-ish: read the current max version for this case, then insert
// version+1. The unique index makes the actual concurrency safety
// belt-and-braces — if two callers race, one wins and the other gets
// a P2002 that they can retry.
//
// We pass a transaction so the SELECT MAX + INSERT happen atomically.
async function snapshotCase(caseId, createdById) {
  return prisma.$transaction(async (tx) => {
    const latest = await tx.testCaseVersion.findFirst({
      where: { case_id: caseId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    const tc = await tx.testCase.findUnique({ where: { id: caseId } });
    if (!tc) throw new Error(`snapshotCase: case ${caseId} not found`);

    return tx.testCaseVersion.create({
      data: {
        case_id: caseId,
        version: nextVersion,
        snapshot: toSnapshot(tc),
        created_by_id: createdById ?? null,
      },
    });
  });
}

module.exports = { snapshotCase, toSnapshot, VERSIONED_FIELDS };