const express = require('express');
const { validate, asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { testSuiteSchema, testSuiteUpdateSchema } = require('../shared/schemas/testSuite');
const { serializeSuite } = require('../utils/serialize');
const { NOT_DELETED } = require('../utils/scope');
const { parseId } = require('../utils/params');
const prisma = require('../db');

const router = express.Router();

// CREATE — POST /test-suites (editor + admin)
router.post(
  '/',
  requireAuth,
  requireRole('admin', 'editor'),
  validate(testSuiteSchema),
  withAudit('test_suite.create', async (req, res) => {
    const { name, description, test_case_ids } = req.body;
    const suite = await prisma.testSuite.create({
      data: { name, description: description || '' },
    });
    if (test_case_ids && test_case_ids.length > 0) {
      await prisma.testSuiteCase.createMany({
        data: test_case_ids.map((caseId) => ({
          test_case_id: caseId,
          test_suite_id: suite.id,
        })),
      });
    }
    res.status(201).json(await serializeSuite(suite));
  }, { target_type: 'test_suite' })
);

// LIST — GET /test-suites (any authenticated user; soft-deleted excluded)
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const suites = await prisma.testSuite.findMany({
      where: NOT_DELETED,
      orderBy: { id: 'asc' },
    });
    const result = await Promise.all(suites.map(serializeSuite));
    res.json(result);
  })
);

// GET ONE — GET /test-suites/:id (any authenticated user; soft-deleted -> 404)
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Test suite not found' });
    const suite = await prisma.testSuite.findFirst({ where: { id, ...NOT_DELETED } });
    if (!suite) return res.status(404).json({ error: 'Test suite not found' });
    res.json(await serializeSuite(suite));
  })
);

// UPDATE — PUT /test-suites/:id (editor + admin)
router.put(
  '/:id',
  requireAuth,
  requireRole('admin', 'editor'),
  validate(testSuiteUpdateSchema),
  withAudit('test_suite.update', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Test suite not found' });
    const { name, description, test_case_ids } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    const updated = await prisma.testSuite.update({ where: { id }, data });
    if (test_case_ids !== undefined) {
      await prisma.testSuiteCase.deleteMany({ where: { test_suite_id: id } });
      if (test_case_ids.length > 0) {
        await prisma.testSuiteCase.createMany({
          data: test_case_ids.map((caseId) => ({
            test_case_id: caseId,
            test_suite_id: id,
          })),
        });
      }
    }
    res.json(await serializeSuite(updated));
  }, {
    target_type: 'test_suite',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id ? prisma.testSuite.findUnique({ where: { id } }) : null;
    },
  })
);

// DELETE — DELETE /test-suites/:id (editor + admin) — soft delete
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'editor'),
  withAudit('test_suite.delete', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Test suite not found' });
    const result = await prisma.testSuite.updateMany({
      where: { id, ...NOT_DELETED },
      data: { deleted_at: new Date() },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Test suite not found' });
    }
    res.status(204).send();
  }, {
    target_type: 'test_suite',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id ? prisma.testSuite.findUnique({ where: { id } }) : null;
    },
  })
);

// RUN ALL — POST /test-suites/:id/run (editor + admin)
// Behaviour preserved from before: marks every non-deleted member case
// as the target result and stamps last_run_at. Kept as-is so the
// existing cypress tests in api/03-test-suites.cy.js continue to pass.
router.post(
  '/:id/run',
  requireAuth,
  requireRole('admin', 'editor'),
  withAudit('test_suite.run', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Test suite not found' });
    const targetResult = (req.body && req.body.result) || 'passed';
    if (!['passed', 'failed'].includes(targetResult)) {
      return res.status(400).json({ error: 'result must be "passed" or "failed"' });
    }

    const links = await prisma.testSuiteCase.findMany({
      where: { test_suite_id: id, test_case: NOT_DELETED },
      select: { test_case_id: true },
    });
    if (!links.length) return res.json({ updated: 0, suite_id: id, result: targetResult });

    const now = new Date();
    const result = await prisma.testCase.updateMany({
      where: { id: { in: links.map((l) => l.test_case_id) } },
      data: { result: targetResult, last_run_at: now },
    });

    // Also create one TestRun row per member case so the dashboard's
    // "Recent runs" feed reflects the suite-wide execution. Best-effort:
    // if the writes fail (rare), the suite still appears as run.
    try {
      const ids = links.map((l) => l.test_case_id);
      const runnerId = Number.isInteger(req.user?.id) ? req.user.id : null;
      await prisma.testRun.createMany({
        data: ids.map((caseId) => ({
          test_case_id: caseId,
          status: targetResult,
          started_at: now,
          finished_at: now,
          run_by_id: runnerId,
        })),
      });
    } catch (_) { /* swallow — the suite-update is the source of truth */ }

    res.json({ updated: result.count, suite_id: id, result: targetResult });
  }, {
    target_type: 'test_suite',
    targetId: (req) => parseId(req.params.id),
  })
);

module.exports = router;