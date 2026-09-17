// middleware/digestLoop.js — periodic background worker that sends the
// daily email digest.
//
// Why this exists: a digest that never fires is useless. This mirrors the
// scheduler loop: wake up on an interval, and when the DIGEST_SCHEDULE
// cron expression's next fire time has passed, compose + send a digest.
//
// Design decisions:
//   - Reuses utils/cron's nextFireFromExpr so the schedule is the same
//     cron syntax as scheduled jobs (default `0 8 * * *`).
//   - "Last fired" is derived from digest_logs (max sent_at), so the loop
//     is idempotent across restarts: recomputing the due window on boot
//     can never double-send within the same schedule period.
//   - Runs only when DIGEST_ENABLED=1 (default off) — matching the
//     conservative opt-in default.
//   - Integration with multi-tenant projects (Feature 4): for now we send
//     the digest for the default project (id 1). Once per-project scoping
//     lands, enumerate active projects here.
//
// Public surface:
//   startDigestLoop() / stopDigestLoop() — process-lifetime control
//   tick() — check schedule + send if due (exported for tests)

const { nextFireFromExpr } = require('../utils/cron');
const { sendDigest } = require('../utils/digest');
const { getDigestSchedule, getDigestEnabled } = require('../utils/settings');

const DEFAULT_TICK_MS = 60 * 1000; // check every minute
const DEFAULT_PROJECT_ID = 1;

let tickHandle = null;
let lastFiredKey = null;
// Process-local re-entrancy guard. If `ticking` is set when `tick` runs,
// the second invocation is dropped on the floor — matches the pattern
// used by middleware/schedulerLoop.js. Combined with the DB-level check
// below, this also prevents a slow SMTP send from being interrupted by
// the next interval firing.
let ticking = false;

const log = (...args) => console.log('[digest-loop]', ...args);

async function lastSentAt(projectId, db) {
  const prisma = require('../db');
  const client = db || prisma;
  const last = await client.digestLog.findFirst({
    where: { project_id: projectId || DEFAULT_PROJECT_ID },
    orderBy: { sent_at: 'desc' },
    select: { sent_at: true },
  });
  return last ? last.sent_at : null;
}

// Returns true when we sent a digest this tick (so tests can await).
async function tick(opts = {}) {
  // Re-entrancy guard. The interval can fire while a previous tick's
  // SMTP send is still in flight; drop the second one on the floor.
  if (ticking && !opts.force) return false;
  ticking = true;
  try {
    // Env gate via the canonical helper — DIGEST_ENABLED=true|1|yes
    // (case-insensitive) all enable the loop. Previously the loop and
    // the helper disagreed: the helper accepted 'true', the loop only
    // accepted literal '1'. Operators setting DIGEST_ENABLED=true got
    // a silent no-op. (Audit B1.)
    if (!getDigestEnabled()) return false;
    const expr = getDigestSchedule();
    const projectId = DEFAULT_PROJECT_ID;
    const last = (await lastSentAt(projectId, opts.prisma)) || new Date(0);
    const now = opts.now || new Date();
    const next = nextFireFromExpr(expr, last);
    if (!next || next > now) return false;
    if (lastFiredKey === `${expr}:${projectId}:${next.toISOString()}`) return false;

    // Multi-instance atomic claim. Before we commit to sending, check
    // whether another instance has already written a digest_log row for
    // this schedule slot. The check is `sent_at >= next` — if any row
    // exists, some other replica (or a previous run that crashed mid-
    // send) already owns this slot. We return false without writing.
    //
    // This doesn't need a new column or unique constraint: it relies on
    // the natural ordering of sent_at + the schedule grid. Combined
    // with the `ticking` flag above (process-local) and `lastFiredKey`
    // (also process-local but seeded by the DB state on boot), we get
    // at-most-once semantics per schedule slot in a multi-instance
    // deployment. (Audit B3.)
    const db = opts.prisma || require('../db');
    const claim = await db.digestLog.findFirst({
      where: {
        project_id: projectId,
        sent_at: { gte: next },
      },
      select: { id: true },
    });
    if (claim) {
      // Some other instance already owns this slot. Stamp the local
      // marker so subsequent ticks on this replica short-circuit too.
      lastFiredKey = `${expr}:${projectId}:${next.toISOString()}`;
      return false;
    }

    log('schedule due — sending digest');
    lastFiredKey = `${expr}:${projectId}:${next.toISOString()}`;
    // Only actually write anything when opts.dry is off (tests use dry).
    if (!opts.dry) {
      await sendDigest(projectId, opts);
    }
    return true;
  } catch (err) {
    log('tick failed:', err.message);
    return false;
  } finally {
    ticking = false;
  }
}

const startDigestLoop = () => {
  if (tickHandle) return;
  const interval = parseInt(process.env.DIGEST_TICK_MS, 10) || DEFAULT_TICK_MS;
  // Kick off the first check on next event-loop tick so boot finishes first.
  setImmediate(() => {
    tick().catch(() => {});
  });
  tickHandle = setInterval(() => { tick().catch(() => {}); }, interval);
  if (tickHandle.unref) tickHandle.unref();
  log('started; tick every', interval, 'ms');
};

const stopDigestLoop = () => {
  if (tickHandle) {
    clearInterval(tickHandle);
    tickHandle = null;
    log('stopped');
  }
};

module.exports = {
  startDigestLoop,
  stopDigestLoop,
  tick,
  DEFAULT_PROJECT_ID,
  _resetForTests: () => {
    lastFiredKey = null;
  },
};