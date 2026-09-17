const express = require('express');
const { validate, asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const requireOwnership = require('../middleware/requireOwnership');
const withAudit = require('../middleware/withAudit');
const { testCaseSchema, testCaseUpdateSchema } = require('../shared/schemas/testCase');
const { serializeTestCase } = require('../utils/serialize');
const { snapshotCase } = require('../utils/snapshot');
const { NOT_DELETED, projectScope } = require('../utils/scope');
const { parseId } = require('../utils/params');
const prisma = require('../db');

const router = express.Router();

// Audit C (audit redaction): redact the 10 KB-executable_snippet
// field from the audit metadata before it lands in audit_events.
// Snippets are user-authored Cypress code; storing them in the
// audit log means every admin / log-aggregator consumer sees them
// unconditionally, and a stolen log dump is effectively a code
// repository. The after selector returns a copy with the snippet
// replaced by its byte length.
const redactSnippet = (snip) =>
  snip == null ? null : { __redacted: 'executable_snippet', bytes: snip.length };

// CREATE — POST /test-cases (editor + admin)
router.post(
  '/',
  requireAuth,
  requireRole('admin', 'editor'),
  validate(testCaseSchema),
  withAudit('test_case.create', async (req, res) => {
    const { title, description, steps, expected_result, status, priority, result, tags, executable_snippet } = req.body;
    const finalResult = result || 'not_run';
    const newTestCase = await prisma.testCase.create({
      data: {
        title,
        description: description || '',
        steps: steps || [],
        expected_result: expected_result || '',
        status: status || 'draft',
        priority: priority || 'medium',
        result: finalResult,
        last_run_at: finalResult !== 'not_run' ? new Date() : null,
        tags: tags || [],
        // The Zod schema's transform already normalizes '' -> null;
        // defaulting to null here makes the contract explicit when the
        // client omits the field entirely.
        executable_snippet: executable_snippet ?? null,
        // Feature 4: every case belongs to its creator's project.
        project_id: projectScope(req.user).project_id,
        // Tag the row with its creator so requireOwnership can enforce
        // "editors can only modify what they created" on PUT/DELETE.
        // NULL is reserved for server-side seeds.
        created_by_id: Number.isInteger(req.user?.id) ? req.user.id : null,
      },
    });
    // Snapshot v1 — the initial state. created_by_id is the actor who
    // created the case. (Snapshot helper will throw on failure; we let
    // it bubble so a partial state isn't observable to clients.)
    await snapshotCase(newTestCase.id, req.user?.id ?? null);
    res.status(201).json(serializeTestCase(newTestCase));
  }, {
    target_type: 'test_case',
    // Audit C (audit redaction): drop the executable_snippet from the
    // audit `after` snapshot. The full row is the live TestCase, and
    // we surface a redacted copy that retains byte-count meta.
    after: (_req, captured) =>
      captured ? { ...captured, executable_snippet: redactSnippet(captured.executable_snippet) } : null,
  })
);

// LIST — GET /test-cases (any authenticated user; soft-deleted excluded)
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const cases = await prisma.testCase.findMany({
      where: { ...NOT_DELETED, ...projectScope(req.user) },
      orderBy: { id: 'asc' },
    });
    res.json(cases.map(serializeTestCase));
  })
);

// GET ONE — GET /test-cases/:id (any authenticated user; soft-deleted -> 404)
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Test case not found' });
    const tc = await prisma.testCase.findFirst({ where: { id, ...NOT_DELETED, ...projectScope(req.user) } });
    if (!tc) return res.status(404).json({ error: 'Test case not found' });
    res.json(serializeTestCase(tc));
  })
);

// UPDATE — PUT /test-cases/:id (editor + admin; ownership enforced)
router.put(
  '/:id',
  requireAuth,
  requireRole('admin', 'editor'),
  requireOwnership({ model: 'testCase' }),
  validate(testCaseUpdateSchema),
  withAudit('test_case.update', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Test case not found' });

    const { title, description, steps, expected_result, status, priority, result, tags, executable_snippet } = req.body;
    const data = {};
    if (title !== undefined) data.title = title;
    if (description !== undefined) data.description = description;
    if (steps !== undefined) data.steps = steps;
    if (expected_result !== undefined) data.expected_result = expected_result;
    if (status !== undefined) data.status = status;
    if (priority !== undefined) data.priority = priority;
    if (result !== undefined) {
      data.result = result;
      if (result !== 'not_run') data.last_run_at = new Date();
    }
    if (tags !== undefined) data.tags = tags;
    // Allow clearing the snippet by sending null/'' (the schema transform
    // already collapses '' to null, but we still forward explicit null).
    if (executable_snippet !== undefined) data.executable_snippet = executable_snippet;

    const updated = await prisma.$transaction(async (tx) => {
      const u = await tx.testCase.update({ where: { id }, data });
      // Convenience shortcut: when a caller sets `result` directly on the
      // case (the legacy UI click handler), also create a TestRun row so
      // the history reflects the execution. Existing callers (UI clicks,
      // legacy tests) keep working without an explicit /runs call.
      if (result !== undefined) {
        await tx.testRun.create({
          data: {
            test_case_id: id,
            status: result,
            finished_at: result !== 'not_run' ? new Date() : null,
            run_by_id: Number.isInteger(req.user?.id) ? req.user.id : null,
          },
        });
      }
      return u;
    });

    // Snapshot the post-update state so the edit history is complete.
    // `created_by_id` is the actor who made this edit (i.e. the user
    // who triggered the update, not the original creator). The
    // snapshot helper uses its own Prisma client (see utils/snapshot.js)
    // — if it fails, the update has already committed and we don't want
    // to roll it back. Logging-only failure is fine; in practice the
    // helper throws before ever reaching DB write.
    await snapshotCase(updated.id, req.user?.id ?? null);

    res.json(serializeTestCase(updated));
  }, {
    target_type: 'test_case',
    targetId: (req) => parseId(req.params.id),
    before: async (req) => {
      const id = parseId(req.params.id);
      if (!id) return null;
      const row = await prisma.testCase.findUnique({ where: { id } });
      // Audit C (audit redaction): redact snippet from the `before`
      // snapshot too — admins reviewing history shouldn't see snippets.
      return row ? { ...row, executable_snippet: redactSnippet(row.executable_snippet) } : null;
    },
    // Audit C (audit redaction): redact the snippet on update too.
    after: (_req, captured) =>
      captured ? { ...captured, executable_snippet: redactSnippet(captured.executable_snippet) } : null,
  })
);

// DELETE — DELETE /test-cases/:id (editor + admin; ownership enforced) — soft delete
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin', 'editor'),
  requireOwnership({ model: 'testCase' }),
  withAudit('test_case.delete', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Test case not found' });
    // Use updateMany so we can detect "already deleted" via count=0
    const result = await prisma.testCase.updateMany({
      where: { id, ...NOT_DELETED, ...projectScope(req.user) },
      data: { deleted_at: new Date() },
    });
    if (result.count === 0) {
      return res.status(404).json({ error: 'Test case not found' });
    }
    res.status(204).send();
  }, {
    target_type: 'test_case',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id ? prisma.testCase.findUnique({ where: { id } }) : null;
    },
  })
);

module.exports = router;