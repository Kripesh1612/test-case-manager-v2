// Flakiness routes.
//
//   GET  /test-cases/flaky                → list cases above threshold
//   GET  /test-cases/flaky?threshold=N    → same with custom threshold
//   GET  /test-cases/:caseId/flakiness    → full report for one case
//
// Both endpoints require authentication. The full report is the most
// useful for the React detail page (it has the per-signal breakdown);
// the list endpoint powers the dashboard widget.

const express = require('express');
const prisma = require('../db');

const requireAuth = require('../middleware/auth');
const { findFlakyCases, analyzeFlakinessForCase } = require('../utils/flakiness');

const router = express.Router();

// IMPORTANT: /test-cases/flaky MUST be registered before the
// :caseId catch-all in index.js, otherwise Express matches it as a
// caseId = "flaky" and 404s. Index.js handles the ordering.

// ---- GET /test-cases/flaky --------------------------------------------
//
// Query params:
//   threshold  (number, 0..100, default 50) — minimum flakiness score
//
// Response: { threshold, count, cases: [{ case_id, title, score,
// verdict, sample_size, last_run_status }] }
router.get('/flaky', requireAuth, async (req, res, next) => {
  try {
    const thresholdRaw = req.query.threshold;
    let threshold = 50;
    if (thresholdRaw != null) {
      const n = Number(thresholdRaw);
      if (!Number.isFinite(n) || n < 0 || n > 100) {
        return res.status(400).json({ error: 'threshold must be 0..100' });
      }
      threshold = n;
    }
    const result = await findFlakyCases(threshold);
    res.json(result);
  } catch (e) {
    next(e);
  }
});

// ---- GET /test-cases/:caseId/flakiness --------------------------------
//
// Full report including per-signal breakdown. 404 if the case is
// missing or soft-deleted.
router.get('/:caseId/flakiness', requireAuth, async (req, res, next) => {
  try {
    const caseId = Number(req.params.caseId);
    if (!Number.isInteger(caseId) || caseId <= 0) {
      return res.status(400).json({ error: 'Invalid caseId' });
    }
    const tc = await prisma.testCase.findFirst({
      where: { id: caseId, deleted_at: null },
      select: { id: true },
    });
    if (!tc) return res.status(404).json({ error: 'Test case not found' });

    const report = await analyzeFlakinessForCase(caseId);
    res.json(report);
  } catch (e) {
    next(e);
  }
});

module.exports = router;
