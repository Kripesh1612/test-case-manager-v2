// routes/execution.js — Phase 8: real test execution.
//
// Exposes two endpoints:
//
//   POST /test-cases/:id/execute
//      Starts a Cypress run against the case's executable_snippet.
//      Validates the case has a snippet, creates a TestRun row with
//      status='running', then fires the executor in the background.
//      Returns 201 with the run id immediately so the UI can start
//      streaming progress.
//
//   GET  /runs/:id/stream
//      Server-Sent Events feed of progress events for a single run.
//      Emits the initial DB snapshot, then forwards every event the
//      executor publishes (stdout/stderr/progress/done).
//
// The stream is open to any authenticated user (not just admins) so a
// viewer can watch a run in progress.

const express = require('express');

const { asyncHandler, sseResponse } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { parseId } = require('../utils/params');
const { NOT_DELETED } = require('../utils/scope');
const { executeCase } = require('../utils/executor');
const runStream = require('../utils/runStream');
const prisma = require('../db');

const router = express.Router();

// ----- POST /test-cases/:id/execute -----
//
// 1. Validate the case exists and has a non-empty snippet.
// 2. Create TestRun row (status='running') so a server-crash mid-run
//    still leaves an audit trail.
// 3. Fire-and-forget executeCase(); errors inside the worker convert to
//    status='errored' on the same row.
router.post(
  '/test-cases/:id/execute',
  requireAuth,
  requireRole('admin', 'editor'),
  withAudit(
    'case.execute',
    async (req, res) => {
      const caseId = parseId(req.params.id);
      if (!caseId) return res.status(404).json({ error: 'Case not found' });

      const tc = await prisma.testCase.findFirst({
        where: { id: caseId, ...NOT_DELETED },
        select: { id: true, executable_snippet: true },
      });
      if (!tc) return res.status(404).json({ error: 'Case not found' });

      const snippet = (tc.executable_snippet || '').trim();
      if (!snippet) {
        return res.status(400).json({
          error: 'Case has no executable snippet. Add one in the editor first.',
        });
      }

      const runById = Number.isInteger(req.user?.id) ? req.user.id : null;
      const run = await prisma.testRun.create({
        data: {
          test_case_id: caseId,
          status: 'running',
          run_by_id: runById,
          started_via: 'manual',
        },
      });

      // Fire-and-forget — `setImmediate` defers the spawn until after
      // res.json returns, so the SSE handler below has a chance to open
      // the stream first. Without this gap the SSE `snapshot` event can
      // race ahead of the run row's existence check.
      setImmediate(() => {
        executeCase({ caseId, runId: run.id, snippet, runById }).catch((err) => {
          // The executor's promise is supposed to always resolve, but
          // defense in depth: a thrown rejection here would leave the
          // row stuck on 'running'. Reflect it in the stream and the DB.
          console.error('[execution] executor promise rejected:', err);
          runStream.emit(run.id, 'done', { status: 'errored' });
        });
      });

      res.status(201).json(run);
    },
    {
      target_type: 'test_case',
      targetId: (req) => parseId(req.params.id),
    },
  ),
);

// ----- GET /runs/:id/stream -----
//
// Long-lived SSE connection. Lifecycle:
//   1. Open: emit a `snapshot` with the current DB row's status so
//      late-arriving clients render correctly even if the executor has
//      already emitted 'done'.
//   2. Forwards all runStream events to the response with the matching
//      runId.
//   3. Cleans up the subscription on socket close.
router.get(
  '/runs/:id/stream',
  requireAuth,
  asyncHandler(async (req, res) => {
    const runId = parseId(req.params.id);
    if (!runId) return res.status(404).end();

    const run = await prisma.testRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true },
    });
    if (!run) return res.status(404).end();

    sseResponse(res);

    // Send the snapshot. The client renders this *before* any live
    // events so a connection that opens after the run completes still
    // sees the terminal state.
    res.sse('snapshot', {
      runId: run.id,
      status: run.status,
    });

    // If the run already finished (reconnect / late open), close the
    // stream — there's nothing left to emit.
    const alreadyDone = ['passed', 'failed', 'errored'].includes(run.status);
    if (alreadyDone) {
      res.end();
      return;
    }

    const unsubscribe = runStream.subscribe(runId, (event, data) => {
      try {
        // Defensive write: an SSE emit arriving after the client
        // disconnected will throw EPIPE here, which would surface as
        // an unhandledRejection.
        res.sse(event, data);
        if (event === 'done') res.end();
      } catch (e) {
        // Client went away — clean up and stop calling write().
        cleanup();
      }
    });

    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      unsubscribe();
    };

    req.on('close', () => {
      cleanup();
      try { res.end(); } catch (_) {}
    });
    req.on('error', () => {
      cleanup();
      try { res.end(); } catch (_) {}
    });
  }),
);

module.exports = router;
