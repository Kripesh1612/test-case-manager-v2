// Case-version endpoints.
//
//   GET  /test-cases/:caseId/versions                 → list (newest first)
//   GET  /test-cases/:caseId/versions/:versionId      → one version + snapshot
//   GET  /test-cases/:caseId/versions/:v1/diff/:v2    → field-by-field diff
//   POST /test-cases/:caseId/versions/:versionId/restore → admin/editor
//
// Versioning is content-based: every create + every update snapshots the
// post-write state. The snapshot is an immutable JSON blob; the live
// `TestCase` row holds the "current" state. Restore copies the snapshot
// back onto the live row AND snapshots the post-restore state, so the
// restore itself is in history.
//
// RBAC:
//   read (list/get/diff)  → any authenticated user
//   restore                → admin + editor (viewers get 403)

const express = require('express');
const { asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const requireOwnership = require('../middleware/requireOwnership');
const withAudit = require('../middleware/withAudit');
const { parseId } = require('../utils/params');
const { serializeTestCase } = require('../utils/serialize');
const { snapshotCase, snapshotCaseInTx, toSnapshot } = require('../utils/snapshot');
const { diffSnapshots } = require('../utils/diff');
const { NOT_DELETED, projectScope } = require('../utils/scope');
const prisma = require('../db');

const router = express.Router({ mergeParams: true });

// Helper: load the case + verify it exists + is not soft-deleted + belongs
// to the caller's project. Used at the top of every endpoint so a bad or
// cross-project :caseId 404s before we even touch the versions table.
async function loadLiveCase(caseId, user) {
  const tc = await prisma.testCase.findFirst({
    where: { id: caseId, ...NOT_DELETED, ...projectScope(user) },
  });
  if (!tc) return null;
  return tc;
}

// Helper: load a specific version row. Returns null if it doesn't exist
// or doesn't belong to the given case (guards against /cases/1/versions/999
// where 999 belongs to case 2).
async function loadVersion(caseId, versionId) {
  const v = await prisma.testCaseVersion.findUnique({ where: { id: versionId } });
  if (!v || v.case_id !== caseId) return null;
  return v;
}

// ---- LIST ----
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const caseId = parseId(req.params.caseId);
    if (!caseId) return res.status(404).json({ error: 'Test case not found' });
    const tc = await loadLiveCase(caseId, req.user);
    if (!tc) return res.status(404).json({ error: 'Test case not found' });

    const versions = await prisma.testCaseVersion.findMany({
      where: { case_id: caseId },
      orderBy: { version: 'desc' },
    });
    // Don't surface the snapshot in the list — it can be large (steps,
    // tags, long descriptions). Clients fetch /:versionId for the full
    // record.
    res.json(
      versions.map((v) => ({
        id: v.id,
        case_id: v.case_id,
        version: v.version,
        created_at: v.created_at.toISOString(),
        created_by_id: v.created_by_id,
      })),
    );
  }),
);

// ---- GET ONE ----
router.get(
  '/:versionId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const caseId = parseId(req.params.caseId);
    const versionId = parseId(req.params.versionId);
    if (!caseId || !versionId) {
      return res.status(404).json({ error: 'Version not found' });
    }
    const tc = await loadLiveCase(caseId, req.user);
    if (!tc) return res.status(404).json({ error: 'Test case not found' });

    const v = await loadVersion(caseId, versionId);
    if (!v) return res.status(404).json({ error: 'Version not found' });

    res.json({
      id: v.id,
      case_id: v.case_id,
      version: v.version,
      created_at: v.created_at.toISOString(),
      created_by_id: v.created_by_id,
      snapshot: v.snapshot,
    });
  }),
);

// ---- DIFF ----
//
// Field-by-field diff between two versions of the same case. Returns an
// array of {field, kind, before, after} — one record per field that
// actually changed. Identical fields are omitted from the response so
// the UI doesn't render empty rows.
//
// Convention: `from_version` is the older side, `to_version` is the
// newer side. Clients can pass them either way (the algorithm is
// symmetric) — we just label them as requested.
router.get(
  '/:fromVersion/diff/:toVersion',
  requireAuth,
  asyncHandler(async (req, res) => {
    const caseId = parseId(req.params.caseId);
    const fromId = parseId(req.params.fromVersion);
    const toId = parseId(req.params.toVersion);
    if (!caseId || !fromId || !toId) {
      return res.status(404).json({ error: 'Version not found' });
    }
    const tc = await loadLiveCase(caseId, req.user);
    if (!tc) return res.status(404).json({ error: 'Test case not found' });

    const [a, b] = await Promise.all([loadVersion(caseId, fromId), loadVersion(caseId, toId)]);
    if (!a || !b) return res.status(404).json({ error: 'Version not found' });

    const fields = diffSnapshots(a.snapshot, b.snapshot);
    res.json({
      from_version: a.version,
      to_version: b.version,
      fields,
    });
  }),
);

// ---- RESTORE ----
//
// Apply a snapshot's fields back to the live row, then snapshot the
// post-restore state so the restore itself becomes a version. This way
// the full audit trail is preserved even for rollbacks.
router.post(
  '/:versionId/restore',
  requireAuth,
  requireRole('admin', 'editor'),
  // Audit C (RBAC): restore is effectively a write to the live row,
  // so an editor must own the case. Admins bypass the check inside
  // requireOwnership. Without this guard, an editor could restore a
  // case authored by someone else, undoing that person's last save.
  requireOwnership({ model: 'testCase' }),
  withAudit(
    'test_case.restore',
    async (req, res) => {
      const caseId = parseId(req.params.caseId);
      const versionId = parseId(req.params.versionId);
      if (!caseId || !versionId) {
        return res.status(404).json({ error: 'Version not found' });
      }
      const tc = await loadLiveCase(caseId, req.user);
      if (!tc) return res.status(404).json({ error: 'Test case not found' });

      const v = await loadVersion(caseId, versionId);
      if (!v) return res.status(404).json({ error: 'Version not found' });

      const snap = v.snapshot;
      // Audit C3 — restore atomically: update the live row AND write
      // the post-restore version in a single transaction. Previously
      // these were separate Prisma calls and a partial failure could
      // leave the case updated with no history of the restore.
      const updated = await prisma.$transaction(async (tx) => {
        const u = await tx.testCase.update({
          where: { id: caseId },
          data: {
            title: snap.title,
            description: snap.description,
            steps: snap.steps,
            expected_result: snap.expected_result,
            priority: snap.priority,
            status: snap.status,
            tags: snap.tags,
            // NOTE: result + last_run_at are NOT in the snapshot (they're
            // metadata, not content). Restore leaves them as they are on
            // the live row.
          },
        });
        await snapshotCaseInTx(tx, caseId, req.user?.id ?? null);
        return u;
      });

      res.json(serializeTestCase(updated));
    },
    {
      target_type: 'test_case',
      targetId: (req) => parseId(req.params.caseId),
      before: (req) => {
        const caseId = parseId(req.params.caseId);
        return caseId ? prisma.testCase.findUnique({ where: { id: caseId } }) : null;
      },
    },
  ),
);

module.exports = router;