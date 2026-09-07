// =============================================================================
// Unit tests for utils/flakiness.js — the three-signal analyzer.
//
// Run: npm run test:unit
//
// We test only the pure function `analyzeFlakiness` and the helpers it
// delegates to. The DB-touching wrappers `analyzeFlakinessForCase` and
// `findFlakyCases` are exercised through the Cypress API tests; here we
// pin the algorithm itself.
//
// Coverage map (for defense review):
//   - insufficient data branch (sample < 5)
//   - ignores `not_run` and other non-terminal statuses
//   - all-pass → stable / score 0
//   - pure alternation → high score
//   - the "broken" override (recent all-fail + baseline was passing)
//   - the structural counter (recent all-fail + baseline was unstable)
//   - windowStats divisor guard
//   - countSwitches: empty, single, identical, alternation
//   - lateFailureIndicator: 0 / 0.5 / 1 cases
//   - respects custom window opts
//
// All runs are constructed with `mk()` so the test bodies stay readable.
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  analyzeFlakiness,
  _internal,
} = require('./flakiness');

const { windowStats, countSwitches, lateFailureIndicator, MIN_RUNS_FOR_VERDICT } = _internal;

// Helper: build N runs with the given statuses, newest-first.
function mk(statuses) {
  const base = Date.UTC(2026, 8, 4, 12, 0, 0); // 2026-09-04 noon UTC
  return statuses.map((status, i) => ({
    status,
    started_at: new Date(base - i * 60_000).toISOString(),
  }));
}

// ---- analyzeFlakiness: input filtering -----------------------------------

test('analyzeFlakiness: sample_size < MIN_RUNS_FOR_VERDICT → insufficient_data + null score', () => {
  const r = analyzeFlakiness(1, mk(['passed', 'failed', 'passed']));
  assert.equal(r.verdict, 'insufficient_data');
  assert.equal(r.score, null);
  assert.equal(r.sample_size, 3);
  assert.equal(MIN_RUNS_FOR_VERDICT, 5); // sanity on the constant
});

test('analyzeFlakiness: ignores not_run / errored rows in sample_size', () => {
  // 7 raw rows; only 4 finished pass/fail. Should report insufficient_data
  // even though the raw list is longer than MIN_RUNS_FOR_VERDICT.
  const r = analyzeFlakiness(1, mk(['passed', 'not_run', 'failed', 'errored', 'passed', 'failed', 'passed']));
  assert.equal(r.sample_size, 5); // 5 finished pass/fail — minimum reached
  assert.notEqual(r.verdict, 'insufficient_data');
});

// ---- analyzeFlakiness: stable cases --------------------------------------

test('analyzeFlakiness: all-pass + all-pass baseline → stable / score 0', () => {
  const statuses = Array(10).fill('passed');
  const r = analyzeFlakiness(1, mk(statuses));
  assert.equal(r.score, 0);
  assert.equal(r.verdict, 'stable');
});

test('analyzeFlakiness: stable when only recent (no baseline yet)', () => {
  // 5 finished passes, no baseline → disagreement falls back to (1 - 1) = 0.
  const r = analyzeFlakiness(1, mk(['passed', 'passed', 'passed', 'passed', 'passed']));
  assert.equal(r.verdict, 'stable');
  assert.equal(r.score, 0);
});

// ---- analyzeFlakiness: flaky cases ---------------------------------------

test('analyzeFlakiness: pure alternation in recent window scores in the "flaky" band', () => {
  // Recent (10): P F P F P F P F P F (newest-first). Baseline: 5 passes.
  // switchRate = 9/9 = 1.0; disagreement = |5/10 - 1| = 0.5; lateFailure = 0.5
  //   (last failed, only 1 pass behind it before next F).
  // raw = 40 * 0.5 + 30 * 1 + 30 * 0.5 = 20 + 30 + 15 = 65 → verdict "flaky".
  const recent = Array.from({ length: 10 }, (_, i) =>
    i % 2 === 0 ? 'passed' : 'failed',
  );
  const baseline = Array(5).fill('passed');
  const r = analyzeFlakiness(1, mk([...recent, ...baseline]));
  assert.ok(r.score >= 50 && r.score < 75, `expected 50..74, got ${r.score}`);
  assert.equal(r.verdict, 'flaky');
});

// ---- analyzeFlakiness: broken / regression override ----------------------

test('analyzeFlakiness: regression (broken) — recent all-fail, baseline was passing', () => {
  // Need ≥ MIN_RUNS_FOR_VERDICT=5 finished runs and ≥ 3 baseline runs
  // for the "broken" structural override to fire. With default windows
  // (recent=10, baseline=20), feed 10 failed + 5 passed (newest-first).
  const statuses = [...Array(10).fill('failed'), ...Array(5).fill('passed')];
  const r = analyzeFlakiness(1, mk(statuses));
  assert.equal(r.recent.failed, 10);
  assert.equal(r.recent.passed, 0);
  assert.equal(r.baseline.window_size, 5);
  assert.equal(r.baseline.pass_rate, 1);
  assert.equal(r.verdict, 'broken');
});

test('analyzeFlakiness: NOT broken when baseline was also unstable', () => {
  // Need enough runs to populate baseline. 10 failed (recent) +
  // 5 50/50 (baseline). Baseline pass-rate = 0.5 < 0.7 → unstable →
  // the broken override does NOT fire.
  const baselineMixed = ['passed', 'failed', 'passed', 'failed', 'passed'];
  const statuses = [...Array(10).fill('failed'), ...baselineMixed];
  const r = analyzeFlakiness(1, mk(statuses));
  assert.notEqual(r.verdict, 'broken');
});

// ---- analyzeFlakiness: opts ----------------------------------------------

test('analyzeFlakiness: respects custom recentWindow / baselineWindow', () => {
  // mk() emits newest-first, so put the recent statuses at the START
  // of the array. With recentWindow=3 and baselineWindow=2:
  //   recent  = first 3 (newest) = [failed, failed, failed]
  //   baseline = next 2          = [passed, passed]
  const statuses = ['failed', 'failed', 'failed', 'passed', 'passed', 'passed', 'passed'];
  const r = analyzeFlakiness(1, mk(statuses), { recentWindow: 3, baselineWindow: 2 });
  assert.equal(r.recent.window_size, 3);
  assert.equal(r.recent.failed, 3);
  assert.equal(r.recent.passed, 0);
  assert.equal(r.baseline.window_size, 2);
  assert.equal(r.baseline.passed, 2);
});

// ---- windowStats ---------------------------------------------------------

test('windowStats: empty window → pass_rate 0 (no division by zero)', () => {
  const s = windowStats([]);
  assert.equal(s.window_size, 0);
  assert.equal(s.passed, 0);
  assert.equal(s.failed, 0);
  assert.equal(s.pass_rate, 0);
});

test('windowStats: pure-pass window', () => {
  const s = windowStats(mk(['passed', 'passed', 'passed']));
  assert.equal(s.pass_rate, 1);
  assert.equal(s.failed, 0);
});

// ---- countSwitches -------------------------------------------------------

test('countSwitches: empty / single-run window → 0', () => {
  assert.equal(countSwitches([]), 0);
  assert.equal(countSwitches(mk(['passed'])), 0);
});

test('countSwitches: identical consecutive runs → 0', () => {
  assert.equal(countSwitches(mk(['passed', 'passed', 'passed'])), 0);
  assert.equal(countSwitches(mk(['failed', 'failed', 'failed'])), 0);
});

test('countSwitches: perfect alternation → N-1', () => {
  // 4 runs, 3 transitions between adjacent pairs.
  assert.equal(countSwitches(mk(['passed', 'failed', 'passed', 'failed'])), 3);
});

// ---- lateFailureIndicator -----------------------------------------------

test('lateFailureIndicator: last run passed → 0', () => {
  assert.equal(lateFailureIndicator(mk(['passed', 'failed', 'passed'])), 0);
  assert.equal(lateFailureIndicator(mk(['passed'])), 0);
});

test('lateFailureIndicator: last run failed with 3+ prior passes → 1', () => {
  // window[0] = F, window[1]=P, window[2]=P, window[3]=P → streak=3 → 1.
  assert.equal(lateFailureIndicator(mk(['failed', 'passed', 'passed', 'passed'])), 1);
});

test('lateFailureIndicator: last run failed with 1 prior pass → 0.5', () => {
  // streak=1 (just the immediate P, then a non-pass at index 2) → 0.5.
  assert.equal(lateFailureIndicator(mk(['failed', 'passed', 'failed'])), 0.5);
});

test('lateFailureIndicator: last run failed with no prior pass → 0.5 (partial credit)', () => {
  // Two consecutive failures — current implementation returns 0.5 by
  // design (we don't differentiate "always broken" here; the broken
  // override handles that at the verdict layer).
  assert.equal(lateFailureIndicator(mk(['failed', 'failed'])), 0.5);
});

test('lateFailureIndicator: empty window → 0', () => {
  assert.equal(lateFailureIndicator([]), 0);
});
