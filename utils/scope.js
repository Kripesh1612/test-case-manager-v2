// soft-delete scope helpers. Used at every read query to exclude trashed
// rows; used by the trash routes to find only trashed rows.
//
// Deliberately explicit rather than a global Prisma $extends interceptor:
// the trash and purge endpoints need to bypass it, which forces an
// escape hatch and turns every query into "which client am I on?".
// In a codebase whose purpose is teaching, `where: { ...NOT_DELETED }`
// at each call site is readable and greppable.

const NOT_DELETED = { deleted_at: null };
const ONLY_DELETED = { deleted_at: { not: null } };

// Include the latest run alongside a test case so the serializer can
// derive the case's `result` and `last_run_at`. Same shape everywhere —
// one source of truth, no drift between call sites.
const LATEST_RUN_INCLUDE = {
  runs: {
    orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
    take: 1,
  },
};

module.exports = { NOT_DELETED, ONLY_DELETED, LATEST_RUN_INCLUDE };