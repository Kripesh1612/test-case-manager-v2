// =============================================================================
// utils/trashPurge.js — background sweep that hard-deletes soft-deleted
// rows older than `TRASH_RETENTION_DAYS`.
//
// Lives here (rather than inside schedulerLoop.js) because:
//   - It's a separate concern: it doesn't depend on ScheduledJob rows
//     or the per-minute tick rate.
//   - It has its own interval (default hourly) so a small drift in the
//     scheduler tick doesn't impact trash retention.
//
// `TRASH_RETENTION_DAYS=0` disables purging entirely (set-and-forget).
// See docs/soft-delete.md and utils/settings.js#getTrashRetentionDays.
// =============================================================================

const prisma = require('../db');
const { getTrashRetentionDays } = require('./settings');

// Default sweep interval. Hourly is plenty for any reasonable retention
// window (the docs default is 30 days, so a one-hour tick + one-day
// window = the window boundary can drift up to 1 hour without anyone
// noticing).
const DEFAULT_SWEEP_INTERVAL_MS = 60 * 60_000; // 1 hour

let sweepHandle = null;
let sweeping = false; // re-entrancy guard

const log = (...args) => console.log('[trash-purge]', ...args);

// Find soft-deleted rows whose `deleted_at` is older than `cutoff` and
// hard-delete them. Returned for tests so they can assert the count.
const sweepOnce = async () => {
  const days = getTrashRetentionDays();
  if (days === 0) return { skipped: true, reason: 'retention disabled' };

  const cutoff = new Date(Date.now() - days * 86400000);

  // Wrap each model in its own try/catch so a failure on one table
  // (FK constraint, locked row, etc.) doesn't block the other.
  const results = { cases: 0, suites: 0 };
  try {
    const r = await prisma.testCase.deleteMany({
      where: { deleted_at: { lt: cutoff, not: null } },
    });
    results.cases = r.count;
  } catch (e) {
    log('case purge error:', e.message);
  }
  try {
    const r = await prisma.testSuite.deleteMany({
      where: { deleted_at: { lt: cutoff, not: null } },
    });
    results.suites = r.count;
  } catch (e) {
    log('suite purge error:', e.message);
  }

  if (results.cases > 0 || results.suites > 0) {
    log(`purged ${results.cases} case(s) and ${results.suites} suite(s) older than ${days}d`);
  }
  return { cutoff: cutoff.toISOString(), days, ...results };
};

const startTrashPurge = () => {
  if (sweepHandle) return; // already running
  if (process.env.TRASH_PURGE_DISABLED === '1') {
    log('disabled via TRASH_PURGE_DISABLED=1');
    return;
  }
  const interval = parseInt(process.env.TRASH_PURGE_INTERVAL_MS, 10) || DEFAULT_SWEEP_INTERVAL_MS;

  // First sweep after a short delay so the server has finished boot
  // (and so a cold start doesn't immediately delete rows the operator
  // is still inspecting). 30s is the same grace the scheduler gives
  // itself before the first tick.
  setTimeout(() => {
    sweeping = true;
    sweepOnce()
      .catch((err) => log('initial sweep failed:', err.message))
      .finally(() => { sweeping = false; });
  }, 30_000);

  sweepHandle = setInterval(() => {
    if (sweeping) return; // previous sweep still running
    sweeping = true;
    sweepOnce()
      .catch((err) => log('periodic sweep failed:', err.message))
      .finally(() => { sweeping = false; });
  }, interval);
  if (sweepHandle.unref) sweepHandle.unref();
  log('started; sweep every', interval, 'ms');
};

const stopTrashPurge = () => {
  if (sweepHandle) {
    clearInterval(sweepHandle);
    sweepHandle = null;
    log('stopped');
  }
};

module.exports = { sweepOnce, startTrashPurge, stopTrashPurge };
