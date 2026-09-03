// /trash — list, restore, and purge soft-deleted cases and suites.
//
// Soft delete is the default behaviour of DELETE /test-cases/:id and
// DELETE /test-suites/:id (see routes/testCases.js + testSuites.js).
// This router is the "undo" surface: an admin can browse trashed rows
// and either bring them back (restore) or hard-delete them (purge).

const express = require('express');
const { asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { parseId } = require('../utils/params');
const { ONLY_DELETED } = require('../utils/scope');
const prisma = require('../db');

const router = express.Router();

// Every endpoint here requires authentication. Read endpoints accept any
// role (so an editor can see "what did I just delete?"); write endpoints
// (restore + purge) are admin-only because they affect shared data.
router.use(requireAuth);

// GET /trash/cases — soft-deleted cases, newest deletion first.
router.get(
  '/cases',
  asyncHandler(async (req, res) => {
    const rows = await prisma.testCase.findMany({
      where: ONLY_DELETED,
      orderBy: [{ deleted_at: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    res.json({ count: rows.length, cases: rows });
  })
);

// GET /trash/suites — soft-deleted suites, newest deletion first.
router.get(
  '/suites',
  asyncHandler(async (req, res) => {
    const rows = await prisma.testSuite.findMany({
      where: ONLY_DELETED,
      orderBy: [{ deleted_at: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    res.json({ count: rows.length, suites: rows });
  })
);

// POST /trash/cases/:id/restore — clear deleted_at on a single case.
router.post(
  '/cases/:id/restore',
  requireRole('admin'),
  withAudit('test_case.restore', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Case not found' });
    const result = await prisma.testCase.updateMany({
      where: { id, ...ONLY_DELETED },
      data: { deleted_at: null },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Case not in trash' });
    }
    const restored = await prisma.testCase.findUnique({ where: { id } });
    res.json(restored);
  }, {
    target_type: 'test_case',
    targetId: (req) => parseId(req.params.id),
  })
);

// POST /trash/suites/:id/restore — clear deleted_at on a single suite.
router.post(
  '/suites/:id/restore',
  requireRole('admin'),
  withAudit('test_suite.restore', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Suite not found' });
    const result = await prisma.testSuite.updateMany({
      where: { id, ...ONLY_DELETED },
      data: { deleted_at: null },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Suite not in trash' });
    }
    const restored = await prisma.testSuite.findUnique({ where: { id } });
    res.json(restored);
  }, {
    target_type: 'test_suite',
    targetId: (req) => parseId(req.params.id),
  })
);

// DELETE /trash/cases/:id — hard delete (purge) a soft-deleted case.
// Refuses if the row isn't currently in the trash, so a regular
// DELETE /test-cases/:id (which soft-deletes) can't accidentally
// bypass the soft-delete contract.
router.delete(
  '/cases/:id',
  requireRole('admin'),
  withAudit('test_case.purge', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Case not found' });
    const result = await prisma.testCase.deleteMany({
      where: { id, ...ONLY_DELETED },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Case not in trash' });
    }
    res.status(204).send();
  }, {
    target_type: 'test_case',
    targetId: (req) => parseId(req.params.id),
  })
);

// DELETE /trash/suites/:id — hard delete (purge) a soft-deleted suite.
router.delete(
  '/suites/:id',
  requireRole('admin'),
  withAudit('test_suite.purge', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Suite not found' });
    const result = await prisma.testSuite.deleteMany({
      where: { id, ...ONLY_DELETED },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Suite not in trash' });
    }
    res.status(204).send();
  }, {
    target_type: 'test_suite',
    targetId: (req) => parseId(req.params.id),
  })
);

module.exports = router;