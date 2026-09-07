// =============================================================================
// Unit tests for utils/cron.js — the heart of the scheduler.
//
// Run: npm run test:unit
//
// Coverage map (for defense review):
//   - parseCron: every supported field token form, every rejection mode
//   - nextFire: weekday skip, year boundary, OR-of-DOM-and-DOW semantics
//   - isValid:  non-throwing wrapper for bad input
//
// We test through the public exports. `matches()` is intentionally left
// private; the integration of matches() with nextFire() is what the
// scheduler actually depends on, so testing nextFire end-to-end is the
// honest test.
//
// All `after` Dates are passed explicitly — never `Date.now()` — so the
// tests are deterministic and the assertions are line-by-line traceable.
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseCron, nextFire, nextFireFromExpr, isValid, nextFireInZone, nextFireFromExprInZone } = require('./cron');

// ---- parseCron: token forms -----------------------------------------------

test('parseCron: bare integers are stored as single-value Sets', () => {
  const p = parseCron('5 9 * * *');
  assert.ok(p.minute.has(5));
  assert.ok(!p.minute.has(6));
  assert.ok(p.hour.has(9));
});

test('parseCron: * expands to the full field range', () => {
  const p = parseCron('* * * * *');
  assert.equal(p.minute.size, 60);
  assert.equal(p.hour.size, 24);
  assert.equal(p.month.size, 12);
});

test('parseCron: */15 yields 0, 15, 30, 45', () => {
  const p = parseCron('*/15 * * * *');
  assert.deepEqual([...p.minute].sort(), [0, 15, 30, 45]);
});

test('parseCron: A-B is the inclusive range', () => {
  const p = parseCron('0 9-17 * * *');
  for (let h = 9; h <= 17; h++) assert.ok(p.hour.has(h));
  assert.ok(!p.hour.has(8));
  assert.ok(!p.hour.has(18));
});

test('parseCron: A,B,C is the union', () => {
  const p = parseCron('0 9,12,17 * * *');
  assert.ok(p.hour.has(9));
  assert.ok(p.hour.has(12));
  assert.ok(p.hour.has(17));
  assert.ok(!p.hour.has(10));
});

test('parseCron: */N yields every-Nth value across the full range', () => {
  const p = parseCron('*/5 * * * *');
  // Sort numerically for cross-runtime stability (Set iteration order
  // under `node --test` can differ from a plain script).
  assert.deepEqual(
    [...p.minute].sort((a, b) => a - b),
    [0, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55],
  );
});

test('parseCron: trims surrounding and internal whitespace', () => {
  const p = parseCron('   0   9   *   *   *   ');
  assert.ok(p.minute.has(0));
  assert.ok(p.hour.has(9));
});

// ---- parseCron: rejections -----------------------------------------------

test('parseCron: rejects wrong field count', () => {
  assert.throws(() => parseCron('0 9 * *'), /expected 5 fields/);
  assert.throws(() => parseCron('0 9 * * * *'), /expected 5 fields/);
});

test('parseCron: rejects out-of-range values per field', () => {
  assert.throws(() => parseCron('60 0 * * *'), /field out of range/);    // minute > 59
  assert.throws(() => parseCron('-1 0 * * *'), /field out of range/);    // minute < 0
  assert.throws(() => parseCron('0 24 * * *'), /field out of range/);    // hour > 23
  assert.throws(() => parseCron('0 0 32 * *'), /field out of range/);    // dom > 31
  assert.throws(() => parseCron('0 0 0 * *'), /field out of range/);     // dom < 1
  assert.throws(() => parseCron('0 0 * 13 *'), /field out of range/);    // month > 12
  assert.throws(() => parseCron('0 0 * * 7'), /field out of range/);     // dow = 7 (range is 0-6, Sun-Sat)
});

test('parseCron: rejects inverted ranges', () => {
  assert.throws(() => parseCron('0 0 * * 5-1'), /field out of range/);  // dow > lo? Actually 5-1 means lo=5, hi=1, hi<lo → fails
});

test('parseCron: rejects bad step syntax', () => {
  assert.throws(() => parseCron('*/0 * * * *'), /bad step/);             // step = 0
  assert.throws(() => parseCron('*/-1 * * * *'), /bad step/);            // negative
  assert.throws(() => parseCron('*/abc * * * *'), /bad step/);           // non-numeric
});

// ---- nextFire: core scheduling -------------------------------------------

test('nextFire: every minute — strictly after `after`', () => {
  const after = new Date('2026-09-04T12:30:00Z');
  const next = nextFireFromExpr('* * * * *', after);
  assert.equal(next.toISOString(), '2026-09-04T12:31:00.000Z');
});

test('nextFire: top of every hour — skips to the next :00', () => {
  const after = new Date('2026-09-04T12:30:00Z');
  const next = nextFireFromExpr('0 * * * *', after);
  assert.equal(next.toISOString(), '2026-09-04T13:00:00.000Z');
});

test('nextFire: weekend skip — Friday 10am schedule "0 9 * * 1-5" waits until Monday 9am', () => {
  // 2026-09-04 was Friday (dow=5, in 1-5 → fires Fri 9am).
  // From Fri 10:00 — past the Fri 9am fire — the next fire is Mon.
  // 2026-09-05 Sat (dow=6, NOT in 1-5 — skipped); 2026-09-06 Sun (dow=0);
  // 2026-09-07 Mon → fires.
  const after = new Date('2026-09-04T10:00:00Z');
  const next = nextFireFromExpr('0 9 * * 1-5', after);
  assert.equal(next.toISOString(), '2026-09-07T09:00:00.000Z');
});

test('nextFire: weekday-and-time — Monday 10am next is Tuesday 9am', () => {
  // 2026-09-07 Monday.
  const after = new Date('2026-09-07T10:00:00Z');
  const next = nextFireFromExpr('0 9 * * 1-5', after);
  assert.equal(next.toISOString(), '2026-09-08T09:00:00.000Z');
});

test('nextFire: year boundary — Dec 31 23:59 → Jan 1 00:00', () => {
  const after = new Date('2026-12-31T23:59:00Z');
  const next = nextFireFromExpr('0 0 1 1 *', after);
  assert.equal(next.toISOString(), '2027-01-01T00:00:00.000Z');
});

test('nextFire: month-bounded target — Sep → next Jan 1', () => {
  // Schedule "30 8 1 1 *" only fires Jan 1 at 08:30.
  const after = new Date('2026-09-04T10:00:00Z');
  const next = nextFireFromExpr('30 8 1 1 *', after);
  assert.equal(next.toISOString(), '2027-01-01T08:30:00.000Z');
});

test('nextFire: OR semantics — both DOM and DOW restricted fires if EITHER matches', () => {
  // Schedule "0 12 15 * 1-5" = noon on the 15th OR noon on weekdays.
  // From Wednesday 2026-09-09 10:00 UTC, the next fire is the same day at
  // noon because Wednesday is a weekday (DOM=9 doesn't match the 15th,
  // but DOW=3 falls in 1-5).
  const after = new Date('2026-09-09T10:00:00Z');
  const next = nextFireFromExpr('0 12 15 * 1-5', after);
  assert.equal(next.toISOString(), '2026-09-09T12:00:00.000Z');
});

test('nextFire: OR semantics — Saturday fires on the next weekday before the DOM day', () => {
  // Schedule "0 12 15 * 1-5" = noon on the 15th OR noon on weekdays.
  // From Sat 2026-09-12 08:00 UTC: 2026-09-12/13 (Sat/Sun) don't fire on DOW;
  // 2026-09-14 Mon fires on DOW=1 — earlier than the 15th — so the next
  // fire is Mon Sep 14 12:00 UTC, not the 15th.
  const after = new Date('2026-09-12T08:00:00Z');
  const next = nextFireFromExpr('0 12 15 * 1-5', after);
  assert.equal(next.toISOString(), '2026-09-14T12:00:00.000Z');
});

test('nextFire: impossible schedule (Feb 30) returns null', () => {
  // Feb has at most 29 days, never 30. No fire within 366-day window.
  const after = new Date('2026-01-01T00:00:00Z');
  const next = nextFireFromExpr('0 0 30 2 *', after);
  assert.equal(next, null);
});

test('nextFire: never matches a millisecond-precision `after` itself', () => {
  // After 12:30:00.500, the next fire for "every minute" is 12:31:00, NOT 12:30.
  const after = new Date('2026-09-04T12:30:00.500Z');
  const next = nextFireFromExpr('* * * * *', after);
  assert.equal(next.toISOString(), '2026-09-04T12:31:00.000Z');
});

// ---- isValid --------------------------------------------------------------

test('isValid: true for valid expressions', () => {
  assert.equal(isValid('0 9 * * 1-5'), true);
  assert.equal(isValid('*/15 * * * *'), true);
  assert.equal(isValid('0 0 1 1 *'), true);
});

test('isValid: false for invalid expressions (no throw)', () => {
  assert.equal(isValid('60 0 * * *'), false);     // out-of-range minute
  assert.equal(isValid('not a cron'), false);     // garbage
  assert.equal(isValid('0 0 * *'), false);        // 4 fields
  assert.equal(isValid(''), false);               // empty
});

// ---- Timezone-aware nextFire --------------------------------------------
//
// These tests pin the contract that ScheduledJob.timezone is honored.
// "0 9 * * *" with timezone="America/New_York" should fire at 09:00
// New_York time = 13:00 (EDT) or 14:00 (EST) UTC — NOT 09:00 UTC.
//
// The CI host's IANA tz database may not have every exotic zone, so
// we use widely-supported ones (UTC, America/New_York, Asia/Kathmandu).

test('nextFireFromExprInZone: timezone=null falls back to UTC path', () => {
  // Same input as nextFireFromExpr — identical output by construction.
  const after = new Date('2026-09-04T12:30:00.500Z');
  const a = nextFireFromExpr('* * * * *', after);
  const b = nextFireFromExprInZone('* * * * *', null, after);
  assert.equal(a.toISOString(), b.toISOString());
});

test('nextFireFromExprInZone: America/New_York at 09:00 wall = 13:00 UTC (EDT, Sept)', () => {
  // "30 9 * * *" = 09:30 New_York. From Sept 8 2026 (a Tuesday), Sept
  // is still EDT (UTC-4). 09:30 EDT = 13:30 UTC.
  const after = new Date('2026-09-08T00:00:00Z');
  const next = nextFireFromExprInZone('30 9 * * *', 'America/New_York', after);
  assert.equal(next.toISOString(), '2026-09-08T13:30:00.000Z');
});

test('nextFireFromExprInZone: Asia/Kathmandu (UTC+5:45) at 09:00 = 03:15 UTC', () => {
  // Nepal is UTC+5:45. "0 9 * * *" in Asia/Kathmandu → 03:15 UTC.
  const after = new Date('2026-09-08T00:00:00Z');
  const next = nextFireFromExprInZone('0 9 * * *', 'Asia/Kathmandu', after);
  assert.equal(next.toISOString(), '2026-09-08T03:15:00.000Z');
});

test('nextFireFromExprInZone: crosses DST correctly (New_York EDT→EST Nov 1 2026)', () => {
  // Nov 1 2026 is the DST flip in the US (clocks fall back 02:00→01:00).
  // "0 9 * * *" in America/New_York: on Oct 31 (EDT) fires at 13:00 UTC;
  // on Nov 1 (EST) fires at 14:00 UTC. We pick "after" so the next
  // fire lands in EST to verify the offset actually changed.
  const after = new Date('2026-10-31T15:00:00Z');
  const next = nextFireFromExprInZone('0 9 * * *', 'America/New_York', after);
  // Nov 1 09:00 EST = 14:00 UTC.
  assert.equal(next.toISOString(), '2026-11-01T14:00:00.000Z');
});

test('nextFireFromExprInZone: unknown timezone throws (not silently UTC)', () => {
  assert.throws(
    () => nextFireFromExprInZone('0 9 * * *', 'America/Nwe_York'),
    /unknown timezone/i,
  );
});

test('nextFireInZone: weekday matches are computed in the zone, not UTC', () => {
  // "0 9 * * 1-5" = 09:00 Mon-Fri in America/New_York.
  // Saturday 2026-09-05 00:00 UTC is Friday Sep 4 20:00 EDT in New_York.
  // The next 09:00-in-zone weekday is Monday Sep 7 = 13:00 UTC.
  const after = new Date('2026-09-05T00:00:00Z');
  const parsed = parseCron('0 9 * * 1-5');
  const next = nextFireInZone(parsed, after, 'America/New_York');
  assert.equal(next.toISOString(), '2026-09-07T13:00:00.000Z');
});
