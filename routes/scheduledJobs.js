// =============================================================================
// /scheduled-jobs — cron-based triggers that run a suite on a schedule.
//
// Why this exists: QA teams want "run the smoke suite every morning at 9" or
// "run regression every Sunday at midnight" without a human clicking. The
// scheduler loop (middleware/schedulerLoop.js) ticks every minute, picks up
// due jobs, fires them, and computes the next fire time.
//
// Auth: only admins can create / update / delete. Manual "run now" is
// admin-only too because it has the same blast radius as the scheduler
// itself. Reads (list / get / history) are open to any authenticated user
// so editors can see what's scheduled without needing admin access.
//
// next_run_at semantics:
//   - on create  : computed from cron right now
//   - on update  : recomputed if cron / enabled / paused changes
//   - after fire : recomputed in the loop (so a paused-then-resumed job
//                  doesn't accidentally back-fill the missed fires)
//
// Validation: the cron expression is run through utils/cron.parseCron,
// which is the same code that computes next_run_at — so by construction,
// a stored job is always one whose next fire can be computed.
// =============================================================================

const express = require('express');
const { validate, asyncHandler } = require('../middleware/http');
const requireAuth = require('../middleware/auth');
const requireRole = require('../middleware/roles');
const withAudit = require('../middleware/withAudit');
const { scheduledJobSchema, scheduledJobUpdateSchema } = require('../shared/schemas/scheduledJob');
const { nextFireFromExpr } = require('../utils/cron');
const { parseId } = require('../utils/params');
const prisma = require('../db');

const router = express.Router();

// Compute next_run_at from a cron expression right now. Returns null if
// the expression somehow yields no fire in the next year (treated by the
// caller as a validation error).
const computeNextRun = (cronExpr) => nextFireFromExpr(cronExpr, new Date());

// LIST — GET /scheduled-jobs (any authed user)
router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const jobs = await prisma.scheduledJob.findMany({
      orderBy: [{ enabled: 'desc' }, { id: 'asc' }],
      include: {
        suite: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });
    res.json(jobs);
  })
);

// READ ONE — GET /scheduled-jobs/:id (any authed user)
router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Scheduled job not found' });
    const job = await prisma.scheduledJob.findUnique({
      where: { id },
      include: {
        suite: { select: { id: true, name: true } },
        created_by: { select: { id: true, name: true, email: true } },
      },
    });
    if (!job) return res.status(404).json({ error: 'Scheduled job not found' });
    res.json(job);
  })
);

// HISTORY — GET /scheduled-jobs/:id/history (any authed user)
// Reads the audit_events log for `scheduled_job.fire` events on this job.
// Useful for the UI's "last 10 runs" column.
router.get(
  '/:id/history',
  requireAuth,
  asyncHandler(async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Scheduled job not found' });
    const events = await prisma.auditEvent.findMany({
      where: { action: 'scheduled_job.fire', target_type: 'scheduled_job', target_id: id },
      orderBy: { created_at: 'desc' },
      take: 25,
    });
    res.json({ count: events.length, events });
  })
);

// CREATE — POST /scheduled-jobs (admin only)
router.post(
  '/',
  requireAuth,
  requireRole('admin'),
  validate(scheduledJobSchema),
  withAudit('scheduled_job.create', async (req, res) => {
    const { name, cron, timezone, suite_id, enabled, max_retries } = req.body;

    // Confirm the suite exists and isn't soft-deleted.
    const suite = await prisma.testSuite.findFirst({
      where: { id: suite_id, deleted_at: null },
      select: { id: true },
    });
    if (!suite) return res.status(400).json({ error: 'suite_id does not reference an active suite' });

    const nextRun = computeNextRun(cron);
    if (!nextRun) return res.status(400).json({ error: 'cron expression yields no fire in the next year' });

    const job = await prisma.scheduledJob.create({
      data: {
        name,
        cron,
        timezone: timezone || 'UTC',
        suite_id,
        enabled: enabled === undefined ? true : enabled,
        max_retries: max_retries || 0,
        next_run_at: nextRun,
        created_by_id: req.user.id,
      },
    });
    res.status(201).json(job);
  }, {
    target_type: 'scheduled_job',
    // captured is the job row the handler just returned to the client.
    targetId: (_req, captured) => (captured && captured.id) || null,
    after: (_req, captured) => captured || null,
  })
);

// UPDATE — PATCH /scheduled-jobs/:id (admin only)
router.patch(
  '/:id',
  requireAuth,
  requireRole('admin'),
  validate(scheduledJobUpdateSchema),
  withAudit('scheduled_job.update', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Scheduled job not found' });
    const existing = await prisma.scheduledJob.findUnique({ where: { id } });
    if (!existing) return res.status(404).json({ error: 'Scheduled job not found' });

    const { name, cron, timezone, suite_id, enabled, max_retries } = req.body;
    const data = {};
    if (name !== undefined) data.name = name;
    if (cron !== undefined) data.cron = cron;
    if (timezone !== undefined) data.timezone = timezone;
    if (max_retries !== undefined) data.max_retries = max_retries;
    if (suite_id !== undefined) {
      const suite = await prisma.testSuite.findFirst({
        where: { id: suite_id, deleted_at: null },
        select: { id: true },
      });
      if (!suite) return res.status(400).json({ error: 'suite_id does not reference an active suite' });
      data.suite_id = suite_id;
    }
    // Recompute next_run_at when the schedule itself or its enable state changes.
    const cronChanged = cron !== undefined && cron !== existing.cron;
    const wasDisabled = existing.enabled === false;
    if (cronChanged || (enabled === true && wasDisabled)) {
      const newCron = cron || existing.cron;
      const nextRun = computeNextRun(newCron);
      if (!nextRun) return res.status(400).json({ error: 'cron expression yields no fire in the next year' });
      data.next_run_at = nextRun;
      // Re-enable clears any pending retry state.
      if (enabled === true && wasDisabled) {
        data.retry_at = null;
        data.retry_count = 0;
        data.last_error = null;
      }
    }
    if (enabled !== undefined) data.enabled = enabled;

    const job = await prisma.scheduledJob.update({ where: { id }, data });
    res.json(job);
  }, {
    target_type: 'scheduled_job',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id ? prisma.scheduledJob.findUnique({ where: { id } }) : null;
    },
  })
);

// DELETE — DELETE /scheduled-jobs/:id (admin only)
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  withAudit('scheduled_job.delete', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Scheduled job not found' });
    // updateMany + count check so we can distinguish "not found" from "already gone".
    const result = await prisma.scheduledJob.deleteMany({ where: { id } });
    if (result.count === 0) return res.status(404).json({ error: 'Scheduled job not found' });
    res.status(204).send();
  }, {
    target_type: 'scheduled_job',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id ? prisma.scheduledJob.findUnique({ where: { id } }) : null;
    },
  })
);

// RUN NOW — POST /scheduled-jobs/:id/run (admin only)
// Manually fires the suite associated with the job, bypassing the schedule.
// Useful for "the schedule is fine, I just want to run it RIGHT NOW".
// Implemented as a thin wrapper around the same suite-run logic the loop
// uses (see schedulerLoop.js#executeJob).
router.post(
  '/:id/run',
  requireAuth,
  requireRole('admin'),
  withAudit('scheduled_job.fire', async (req, res) => {
    const id = parseId(req.params.id);
    if (!id) return res.status(404).json({ error: 'Scheduled job not found' });
    const job = await prisma.scheduledJob.findUnique({ where: { id } });
    if (!job) return res.status(404).json({ error: 'Scheduled job not found' });

    // Lazy-require to avoid a circular import (schedulerLoop -> routes).
    const { executeJob } = require('../middleware/schedulerLoop');
    const result = await executeJob(job, { trigger: 'manual', actor: req.user });
    res.json(result);
  }, {
    target_type: 'scheduled_job',
    targetId: (req) => parseId(req.params.id),
    before: (req) => {
      const id = parseId(req.params.id);
      return id ? prisma.scheduledJob.findUnique({ where: { id } }) : null;
    },
  })
);

module.exports = router;
