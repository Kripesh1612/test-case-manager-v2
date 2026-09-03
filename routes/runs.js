// /runs — TestRun history.
//
// A TestRun is a single execution of a test case. Replaces the legacy
// single `TestCase.result` field with a real history ("what happened
// when we ran this last Tuesday?") plus who ran it and any notes.
//
// Routes:
//   POST   /test-cases/:id/runs             authed, write-role — start a run
//   PUT    /test-cases/:id/runs/:runId      authed, write-role — finish it
//   GET    /test-cases/:id/runs             authed, any-role   — history
//   GET    /runs/recent?days=7              authed, any-role   — dashboard feed

const express = require('express');
const { asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { parseId } = require('../utils/params');
const { NOT_DELETED } = require('../utils/scope');
const prisma = require('../db');

const router = express.Router();

// Allowed set of TestRun.status values. Widened in Phase 8 to support
// 'running' (in-flight executor) and 'errored' (Cypress crashed mid-run).
// Keep this list in sync with the comment on TestRun.status in
// prisma/schema.prisma.
const ALLOWED_RUN_STATUS = ['not_run', 'running', 'passed', 'failed', 'errored'];

// All routes require authentication, but applied per-route rather than
// at the router level — the router is mounted at / via app.use(runRoutes)
// so a router.use(requireAuth) would intercept unrelated paths like
// /health.

const clampInt = (raw, lo, hi, dflt) => {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

// POST /test-cases/:id/runs — start a new run. Default status "not_run"
// and started_at=now. Returns the run row.
router.post(
  '/test-cases/:id/runs',
  requireAuth,
  requireRole('admin', 'editor'),
  withAudit('run.start', async (req, res) => {
    const caseId = parseId(req.params.id);
    if (!caseId) return res.status(404).json({ error: 'Case not found' });
    const tc = await prisma.testCase.findFirst({
      where: { id: caseId, ...NOT_DELETED },
      select: { id: true },
    });
    if (!tc) return res.status(404).json({ error: 'Case not found' });

    const run = await prisma.testRun.create({
      data: {
        test_case_id: caseId,
        status: 'not_run',
        run_by_id: Number.isInteger(req.user?.id) ? req.user.id : null,
      },
    });
    res.status(201).json(run);
  }, {
    target_type: 'run',
    targetId: (_req, captured) => (captured && captured.id) || null,
    after: (_req, captured) => captured,
  })
);

// PUT /test-cases/:id/runs/:runId — finish a run. Sets status,
// finished_at, duration_ms (if started_at was provided), and notes.
// If the body has `started_at`, we compute duration_ms from it.
router.put(
  '/test-cases/:id/runs/:runId',
  requireAuth,
  requireRole('admin', 'editor'),
  withAudit('run.finish', async (req, res) => {
    const caseId = parseId(req.params.id);
    const runId = parseId(req.params.runId);
    if (!caseId || !runId) return res.status(404).json({ error: 'Run not found' });

    const { status, notes, started_at, error_log, assertion_count, exit_code, started_via } = req.body || {};
    if (status && !ALLOWED_RUN_STATUS.includes(status)) {
      return res.status(400).json({ error: `status must be one of ${ALLOWED_RUN_STATUS.join(', ')}` });
    }

    const existing = await prisma.testRun.findFirst({
      where: { id: runId, test_case_id: caseId },
    });
    if (!existing) return res.status(404).json({ error: 'Run not found' });

    const data = {};
    if (status) data.status = status;
    if (typeof notes === 'string') data.notes = notes;
    // Phase 8 — executor fields. Trust only scalar-shaped values; anything
    // else falls through silently so a malformed PUT can't crash the request.
    if (typeof error_log === 'string') data.error_log = error_log.slice(0, 4 * 1024);
    if (Number.isInteger(assertion_count)) data.assertion_count = assertion_count;
    if (Number.isInteger(exit_code)) data.exit_code = exit_code;
    if (typeof started_via === 'string' && started_via.length <= 32) data.started_via = started_via;
    if (status && !['not_run', 'running'].includes(status) && !existing.finished_at) {
      data.finished_at = new Date();
    }
    const startTs = started_at ? new Date(started_at) : existing.started_at;
    if (data.finished_at && startTs) {
      data.duration_ms = Math.max(0, data.finished_at.getTime() - startTs.getTime());
    }

    const updated = await prisma.testRun.update({
      where: { id: runId },
      data,
    });

    // Update the parent case's last_run_at so the dashboard can sort by it.
    if (data.finished_at) {
      await prisma.testCase.update({
        where: { id: caseId },
        data: { last_run_at: data.finished_at },
      });
    }

    res.json(updated);
  }, {
    target_type: 'run',
    targetId: (req) => parseId(req.params.runId),
    before: async (req) => {
      const id = parseId(req.params.runId);
      return id ? prisma.testRun.findUnique({ where: { id } }) : null;
    },
  })
);

// GET /test-cases/:id/runs — list runs for one case, newest first.
router.get(
  '/test-cases/:id/runs',
  requireAuth,
  asyncHandler(async (req, res) => {
    const caseId = parseId(req.params.id);
    if (!caseId) return res.status(404).json({ error: 'Case not found' });

    const limit = clampInt(req.query.limit, 1, 200, 50);
    const runs = await prisma.testRun.findMany({
      where: { test_case_id: caseId },
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        run_by: { select: { id: true, email: true, name: true, role: true } },
      },
    });
    res.json({ count: runs.length, runs });
  })
);

// GET /runs/recent?days=7 — runs finished in the last N days, across all
// cases. Used by the dashboard's "Recent runs" section.
router.get(
  '/runs/recent',
  requireAuth,
  asyncHandler(async (req, res) => {
    const days = clampInt(req.query.days, 1, 365, 7);
    const limit = clampInt(req.query.limit, 1, 200, 50);
    const since = new Date(Date.now() - days * 86400000);

    const runs = await prisma.testRun.findMany({
      where: { started_at: { gte: since } },
      orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
      take: limit,
      include: {
        test_case: {
          select: { id: true, title: true, deleted_at: true },
        },
        run_by: { select: { id: true, email: true, name: true, role: true } },
      },
    });

    res.json({ days, count: runs.length, runs });
  })
);

module.exports = router;