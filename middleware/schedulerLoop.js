// =============================================================================
// /scheduler loop — periodic background worker that fires due ScheduledJobs.
//
// Why this exists: cron-based triggers have to actually fire. Routes give us
// CRUD; this file is the "wake up every minute, find due jobs, run them"
// part. It runs entirely in-process — no Redis, no separate worker — because
// for a single-app test manager the operational cost of a queue isn't worth
// the throughput gain.
//
// Concurrency model: optimistic-claim. Each tick finds candidates where
// `next_run_at <= now OR retry_at <= now`, then for each candidate does
// `UPDATE WHERE next_run_at = <expected value>`. If the row has already
// been claimed by another tick (or by an admin re-scheduling), the WHERE
// no longer matches and the UPDATE affects 0 rows — we silently skip. This
// means a slow tick can never double-fire even if the timer drifts.
//
// Retry policy: bounded exponential backoff with jitter. On failure, the
// job's `retry_count` is incremented and `retry_at` set to now +
// 2^retry_count minutes (+ 0–30s jitter). Once retry_count exceeds
// max_retries the job stays in an error state — no automatic resurrection
// — and an admin has to intervene. We treat "max_retries=0" as "no
// retries; first failure is final" which is the right default for new
// users who haven't tuned it.
//
// Public surface:
//   startScheduler()        kick off the interval; safe to call once at boot
//   stopScheduler()         clear the interval (graceful shutdown)
//   tick()                  run one tick on demand (used by tests)
//   executeJob(job, opts)   fire one job synchronously; reused by the
//                           manual `/scheduled-jobs/:id/run` route
//   recomputeAllDue()       backfill next_run_at on jobs that lack one
// =============================================================================

const prisma = require('../db');
const { nextFireFromExpr, nextFireFromExprInZone } = require('../utils/cron');
const { NOT_DELETED } = require('../utils/scope');

// Default tick interval (ms). Configurable via SCHEDULER_TICK_MS env so
// tests can crank it down to a few hundred ms.
const DEFAULT_TICK_MS = 60_000;

// Maximum jitter to add on top of exponential backoff. 30 s is enough to
// spread retries across instances if you ever scale out without being
// large enough to matter to humans watching the audit log.
const RETRY_JITTER_MS_MAX = 30_000;

// Upper bound on the backoff — beyond this it stops growing so a flapping
// job doesn't try to retry in a year.
const RETRY_BACKOFF_CAP_MS = 60 * 60_000;

// ---- internal state ----
let tickHandle = null;
let ticking = false; // re-entrancy guard: don't let a slow tick start another

const log = (...args) => console.log('[scheduler]', ...args);

// -----------------------------------------------------------------------------
// executeJob — run a single job. Used by both the loop AND the manual
// `/scheduled-jobs/:id/run` route, so this is the single source of truth
// for what "fire a job" means.
//
// What "fire" does, in order:
//   1. Resolve the suite. If it's been soft-deleted since the job was
//      created, we treat that as a no-op (the job will retry, then stop).
//   2. Collect every member case that isn't itself soft-deleted.
//   3. Create one TestRun row per case with status="not_run" and
//      run_by_id=null (system-initiated). This gives the dashboard's
//      "recent runs" feed a hook for scheduler-driven activity without
//      pretending we know the actual pass/fail outcome.
//   4. Bump last_run_at on each case so the case card shows a recent run.
//
// We deliberately do NOT update the case's `result` — there's no real
// result to record. That's the difference between this and the manual
// `/test-suites/:id/run` endpoint, which has a `result` in the body.
// -----------------------------------------------------------------------------
const executeJob = async (job, opts = {}) => {
  const firedAt = new Date();

  // Re-fetch the suite to make sure it's still alive. We may have been
  // queued by an earlier tick while the suite was live but it's gone now.
  const suite = await prisma.testSuite.findFirst({
    where: { id: job.suite_id, ...NOT_DELETED },
    select: { id: true, name: true },
  });
  if (!suite) {
    const err = new Error(`Suite ${job.suite_id} not found or has been deleted`);
    err.code = 'SUITE_GONE';
    throw err;
  }

  // Active member cases — exclude soft-deleted ones so a trashed case
  // doesn't get a TestRun row.
  const links = await prisma.testSuiteCase.findMany({
    where: { test_suite_id: suite.id, test_case: NOT_DELETED },
    select: { test_case_id: true },
  });
  const caseIds = links.map((l) => l.test_case_id);

  if (caseIds.length === 0) {
    return {
      job_id: job.id,
      suite_id: suite.id,
      fired_at: firedAt,
      trigger: opts.trigger || 'scheduler',
      runs_created: 0,
      skipped: true,
      reason: 'suite has no active member cases',
    };
  }

  // One TestRun per case — represents "this case was triggered at this
  // time, awaiting execution result". A future test-runner integration
  // can update the status field when the real run finishes.
  await prisma.testRun.createMany({
    data: caseIds.map((caseId) => ({
      test_case_id: caseId,
      status: 'not_run',
      started_at: firedAt,
      finished_at: firedAt,
      run_by_id: null, // system-initiated; manual runs use the user's id
    })),
  });

  // Stamp last_run_at on each case so the UI shows them as recently run.
  await prisma.testCase.updateMany({
    where: { id: { in: caseIds } },
    data: { last_run_at: firedAt },
  });

  return {
    job_id: job.id,
    suite_id: suite.id,
    fired_at: firedAt,
    trigger: opts.trigger || 'scheduler',
    runs_created: caseIds.length,
  };
};

// -----------------------------------------------------------------------------
// claimJob — atomic transition from "due" to "claimed".
//
// Uses optimistic concurrency: the WHERE clause includes the value we just
// read for next_run_at. If some other tick (or a PATCH from an admin)
// already moved the row, the WHERE doesn't match and we get count=0.
//
// After claiming, `retry_at` is cleared and `next_run_at` is advanced to
// the next valid fire time computed from the cron expression. This is
// what guarantees we never double-fire even if `executeJob` itself is slow.
// -----------------------------------------------------------------------------
const claimJob = async (job) => {
  const now = new Date();
  const isRetry = job.retry_at && job.retry_at <= now;

  // Compute the next fire time AFTER the current claim window. We
  // deliberately advance past `now` so a job that runs at 9:00:00 and
  // took 90 seconds to execute won't immediately re-fire at 9:01:30.
  // If the job has a timezone, honor it; otherwise stay in UTC.
  const nextRun = job.timezone && job.timezone !== 'UTC'
    ? nextFireFromExprInZone(job.cron, job.timezone, now)
    : nextFireFromExpr(job.cron, now);
  if (!nextRun) {
    // The cron expression has become un-evaluable (shouldn't happen —
    // we validate on write). Treat as a failure so the retry policy
    // surfaces it.
    const err = new Error(`cron expression "${job.cron}" has no future fire`);
    err.code = 'INVALID_CRON';
    throw err;
  }

  const claimed = await prisma.scheduledJob.updateMany({
    where: {
      id: job.id,
      ...(isRetry ? { retry_at: job.retry_at } : { next_run_at: job.next_run_at }),
    },
    data: {
      next_run_at: nextRun,
      retry_at: null,
      retry_count: isRetry ? job.retry_count : 0, // a fresh start-of-fire
    },
  });
  return claimed.count === 1;
};

// -----------------------------------------------------------------------------
// recordSuccess / recordFailure — bookkeeping after executeJob returns.
// Kept separate from executeJob so the retry policy is easy to read in one
// place.
// -----------------------------------------------------------------------------
const recordSuccess = async (job, firedAt) => {
  await prisma.scheduledJob.update({
    where: { id: job.id },
    data: {
      last_run_at: firedAt,
      retry_count: 0,
      retry_at: null,
      last_error: null,
    },
  });
};

const recordFailure = async (job, err) => {
  const newCount = job.retry_count + 1;
  if (newCount > job.max_retries) {
    // Out of retries — stay in error state. next_run_at is already set
    // to the next valid fire by claimJob, so the scheduler will TRY to
    // fire again at the next scheduled time, but the error message
    // remains until an admin intervenes. (Some folks prefer "disable on
    // exhausted retries" — that's a policy choice left to the operator.)
    await prisma.scheduledJob.update({
      where: { id: job.id },
      data: {
        last_error: String(err && err.message ? err.message : err).slice(0, 1000),
        retry_count: newCount,
      },
    });
    return;
  }

  // Exponential backoff: 2^newCount minutes, capped, plus jitter.
  const backoffMs = Math.min(
    RETRY_BACKOFF_CAP_MS,
    Math.pow(2, newCount) * 60_000
  ) + Math.floor(Math.random() * RETRY_JITTER_MS_MAX);

  await prisma.scheduledJob.update({
    where: { id: job.id },
    data: {
      last_error: String(err && err.message ? err.message : err).slice(0, 1000),
      retry_count: newCount,
      retry_at: new Date(Date.now() + backoffMs),
    },
  });
};

// -----------------------------------------------------------------------------
// tickOne — claim + execute + bookkeeping for one job. Errors are caught
// locally so one misbehaving job can't take down the whole tick.
// -----------------------------------------------------------------------------
const tickOne = async (job) => {
  let claimed;
  try {
    claimed = await claimJob(job);
  } catch (err) {
    log('claim error for job', job.id, '-', err.message);
    return;
  }
  if (!claimed) {
    // Lost the race to another tick. Not an error.
    return;
  }

  let result;
  try {
    result = await executeJob(job);
    await recordSuccess(job, result.fired_at);
    log('fired job', job.id, '-', result.runs_created, 'run(s) for suite', result.suite_id);
  } catch (err) {
    log('execution error for job', job.id, '-', err.message);
    try { await recordFailure(job, err); } catch (e) {
      log('failed to record failure for job', job.id, '-', e.message);
    }
  }
};

// -----------------------------------------------------------------------------
// tick — the public one-tick entry point. Reads candidates and processes
// them in parallel (Prisma's connection pool absorbs the concurrency;
// each individual executeJob is small).
//
// The `ticking` flag prevents re-entrancy — if a tick takes longer than
// the interval (e.g. the DB hung), we don't want to pile up overlapping
// ticks. The next interval will just run normally.
// -----------------------------------------------------------------------------
const tick = async () => {
  if (ticking) return; // skip; previous tick still running
  ticking = true;
  try {
    const now = new Date();
    const candidates = await prisma.scheduledJob.findMany({
      where: {
        enabled: true,
        OR: [
          { next_run_at: { lte: now } },
          { retry_at: { lte: now } },
        ],
      },
    });
    if (candidates.length === 0) return;
    log('tick: found', candidates.length, 'due job(s)');
    // Each tickOne is independent; run them in parallel for wall-clock.
    // Failures are caught inside tickOne so Promise.all never rejects.
    await Promise.all(candidates.map(tickOne));
  } catch (err) {
    log('tick error:', err.message);
  } finally {
    ticking = false;
  }
};

// -----------------------------------------------------------------------------
// recomputeAllDue — backfill any job whose next_run_at is null. Mostly
// relevant at first boot after a deploy that added new fields; idempotent
// and cheap.
// -----------------------------------------------------------------------------
const recomputeAllDue = async () => {
  const jobs = await prisma.scheduledJob.findMany({
    where: { next_run_at: null, enabled: true },
    select: { id: true, cron: true },
  });
  if (jobs.length === 0) return;
  log('backfilling next_run_at for', jobs.length, 'job(s)');
  for (const j of jobs) {
    const next = j.timezone && j.timezone !== 'UTC'
      ? nextFireFromExprInZone(j.cron, j.timezone, new Date())
      : nextFireFromExpr(j.cron, new Date());
    if (next) {
      await prisma.scheduledJob.update({ where: { id: j.id }, data: { next_run_at: next } });
    }
  }
};

// -----------------------------------------------------------------------------
// startScheduler / stopScheduler — process-lifetime control.
//
// SCHEDULER_TICK_MS env override exists for tests that want a tight loop.
// SCHEDULER_DISABLED=1 short-circuits start entirely (for CI runs that
// don't want the loop eating CPU).
// -----------------------------------------------------------------------------
const startScheduler = () => {
  if (tickHandle) return; // already running
  if (process.env.SCHEDULER_DISABLED === '1') {
    log('disabled via SCHEDULER_DISABLED=1');
    return;
  }
  const interval = parseInt(process.env.SCHEDULER_TICK_MS, 10) || DEFAULT_TICK_MS;

  // Kick off the first tick on next event-loop tick so the caller can
  // finish booting without waiting on us.
  setImmediate(() => {
    recomputeAllDue()
      .then(() => tick())
      .catch((err) => log('startup tick failed:', err.message));
  });

  tickHandle = setInterval(() => { tick().catch(() => {}); }, interval);
  // Don't keep the process alive just for the scheduler.
  if (tickHandle.unref) tickHandle.unref();
  log('started; tick every', interval, 'ms');
};

const stopScheduler = () => {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
    log('stopped');
  }
};

module.exports = {
  startScheduler,
  stopScheduler,
  tick,
  executeJob,
  recomputeAllDue,
};
