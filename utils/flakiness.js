// Flakiness analyzer.
//
// Given a TestCase's recent TestRun history, compute a 0–100 score and
// a categorical verdict describing how consistent the case's pass/fail
// pattern is. The score blends three signals:
//
//   1. disagreement      — recent-window pass rate vs baseline-window
//                          pass rate. A case that was 100% reliable and
//                          now sits at 60% has shifted.
//   2. switch_rate       — alternations between consecutive runs in
//                          the recent window. Pure alternation
//                          (PFPF…) is the textbook flake signature.
//   3. late_failure      — was the most recent run a failure? Was it
//                          preceded by a stable streak? This catches
//                          "broke after 10 green runs" patterns.
//
// `verdict` is a category derived from the score plus a structural
// check: a case whose last few runs are all `failed` after a stable
// baseline is a *regression*, not a flake, so we label it `broken`
// instead.
//
// Algorithm references (name-droppable for a CSIT viva):
//   - Rolling window statistics (last N vs prior M).
//   - Alternation/run-length encoding as a proxy for sequence noise.
//   - Disagreement as a coarse proxy for the chi-squared / binomial
//     two-proportion test, without the strict asymptotic assumptions.

const prisma = require('../db');

// Windows — kept configurable for tests.
const DEFAULT_RECENT_WINDOW = 10;
const DEFAULT_BASELINE_WINDOW = 20;
const MIN_RUNS_FOR_VERDICT = 5;

/**
 * @typedef {Object} FlakinessRun
 * @property {'passed'|'failed'} status
 * @property {Date|string}        started_at
 */

/**
 * Compute the flakiness report for one case from its raw run list.
 * Pure function — no DB access — so the algorithm is unit-testable
 * and deterministic.
 *
 * @param {number} caseId
 * @param {FlakinessRun[]} runs   newest-first
 * @returns {import('../shared/schemas/flakiness').flakinessReportSchema}
 */
function analyzeFlakiness(
  caseId,
  runs,
  opts = {},
) {
  const recentWindow = opts.recentWindow ?? DEFAULT_RECENT_WINDOW;
  const baselineWindow = opts.baselineWindow ?? DEFAULT_BASELINE_WINDOW;

  // Only finished runs with a pass/fail status count. `not_run` runs
  // (cases that were queued but never executed) are noise.
  const finished = runs
    .filter((r) => r.status === 'passed' || r.status === 'failed')
    .map((r) => ({ status: r.status, started_at: r.started_at }));

  const last = finished[0] ?? null;

  if (finished.length < MIN_RUNS_FOR_VERDICT) {
    return {
      case_id: caseId,
      score: null,
      verdict: 'insufficient_data',
      sample_size: finished.length,
      recent: emptyWindow(),
      baseline: emptyWindow(),
      signals: { disagreement: 0, switch_rate: 0, late_failure: 0 },
      last_run_at: last ? toIso(last.started_at) : null,
      last_run_status: last ? last.status : null,
    };
  }

  const recent = finished.slice(0, recentWindow);
  const baseline = finished.slice(recentWindow, recentWindow + baselineWindow);

  const recentStats = windowStats(recent);
  const baselineStats = windowStats(baseline);

  // ---- Signals -----------------------------------------------------
  // disagreement: |p_recent - p_baseline|. If no baseline, fall back
  // to failure rate in recent.
  let disagreement;
  if (baseline.length >= 3) {
    disagreement = clamp01(Math.abs(recentStats.pass_rate - baselineStats.pass_rate));
  } else {
    disagreement = clamp01(1 - recentStats.pass_rate);
  }

  // switch_rate: alternations / max-possible-alternations in the
  // recent window. Pure alternation → 1; monotone → 0.
  const switches = countSwitches(recent);
  const switchRate = recent.length > 1 ? switches / (recent.length - 1) : 0;

  // late_failure: 1 if last run failed AND prior 3+ were all passes;
  //                0.5 if last run failed but the streak was mixed;
  //                0 if last run passed or no recent failure.
  const lateFailure = lateFailureIndicator(recent);

  // ---- Score -------------------------------------------------------
  // Weights chosen so a "perfectly textbook flake" (full disagreement,
  // full alternation, recent failure after green streak) lands at ~100.
  const raw =
    40 * disagreement + 30 * switchRate + 30 * lateFailure;
  const score = Math.round(Math.min(100, Math.max(0, raw)) * 10) / 10;

  // ---- Verdict -----------------------------------------------------
  // Structural override: if the recent window is all-fail but the
  // baseline had passing runs, this is a regression (broken), not a
  // flake — flakes recover, regressions don't (until fixed).
  let verdict;
  const recentAllFail =
    recentStats.failed >= MIN_RUNS_FOR_VERDICT && recentStats.passed === 0;
  const baselineWasStable = baselineStats.pass_rate >= 0.7;

  if (recentAllFail && baselineWasStable) {
    verdict = 'broken';
  } else if (score >= 75) {
    verdict = 'very_flaky';
  } else if (score >= 50) {
    verdict = 'flaky';
  } else if (score >= 25) {
    verdict = 'possibly_flaky';
  } else {
    verdict = 'stable';
  }

  return {
    case_id: caseId,
    score,
    verdict,
    sample_size: finished.length,
    recent: recentStats,
    baseline: baselineStats,
    signals: {
      disagreement: round(disagreement, 4),
      switch_rate: round(switchRate, 4),
      late_failure: lateFailure,
    },
    last_run_at: last ? toIso(last.started_at) : null,
    last_run_status: last ? last.status : null,
  };
}

function windowStats(window) {
  const passed = window.filter((r) => r.status === 'passed').length;
  const failed = window.filter((r) => r.status === 'failed').length;
  const total = passed + failed;
  return {
    window_size: total,
    passed,
    failed,
    pass_rate: total === 0 ? 0 : round(passed / total, 4),
  };
}

function emptyWindow() {
  return { window_size: 0, passed: 0, failed: 0, pass_rate: 0 };
}

function countSwitches(window) {
  let n = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].status !== window[i - 1].status) n++;
  }
  return n;
}

function lateFailureIndicator(window) {
  if (window.length === 0) return 0;
  if (window[0].status !== 'failed') return 0;
  // Last run failed. Was there a stable streak of >=3 passes right
  // before it? Look at indices 1..N until we hit a non-pass.
  let streak = 0;
  for (let i = 1; i < window.length; i++) {
    if (window[i].status === 'passed') streak++;
    else break;
  }
  if (streak >= 3) return 1;
  if (streak >= 1) return 0.5;
  return 0.5; // last run failed AND so did the previous ones — partial credit
}

function clamp01(n) {
  return Math.max(0, Math.min(1, n));
}
function round(n, digits) {
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}
function toIso(v) {
  return v instanceof Date ? v.toISOString() : String(v);
}

/**
 * Fetch recent runs for a case, newest first, and analyze.
 * Loads up to (recent + baseline) * 2 finished runs to leave headroom
 * for `not_run` noise.
 */
async function analyzeFlakinessForCase(caseId, opts = {}) {
  const recentWindow = opts.recentWindow ?? DEFAULT_RECENT_WINDOW;
  const baselineWindow = opts.baselineWindow ?? DEFAULT_BASELINE_WINDOW;
  const take = (recentWindow + baselineWindow) * 2;

  const runs = await prisma.testRun.findMany({
    where: { test_case_id: caseId },
    // Secondary `id: 'desc'` is a deterministic tie-breaker when many
    // runs share the same started_at (e.g. when a batch is seeded at
    // once). Without it, Postgres' ORDER BY DESC is undefined on ties
    // and the recent/baseline window split becomes non-reproducible.
    orderBy: [{ started_at: 'desc' }, { id: 'desc' }],
    take,
    select: { status: true, started_at: true },
  });

  return analyzeFlakiness(caseId, runs, opts);
}

/**
 * Batch analyze every (non-deleted) case in the workspace and return
 * only the ones whose score meets or exceeds `threshold`.
 *
 * `threshold` defaults to 50 (the "flaky" cutoff). Pass 25 to include
 * "possibly flaky" too.
 */
async function findFlakyCases(threshold = 50) {
  const cases = await prisma.testCase.findMany({
    where: { deleted_at: null },
    select: { id: true, title: true },
  });

  const reports = [];
  for (const c of cases) {
    const r = await analyzeFlakinessForCase(c.id);
    if (r.score !== null && r.score !== undefined && r.score >= threshold) {
      reports.push({
        case_id: r.case_id,
        score: r.score,
        verdict: r.verdict,
        sample_size: r.sample_size,
        last_run_status: r.last_run_status,
        title: c.title,
      });
    }
  }

  reports.sort((a, b) => b.score - a.score);
  return {
    threshold,
    count: reports.length,
    cases: reports,
  };
}

module.exports = {
  analyzeFlakiness,
  analyzeFlakinessForCase,
  findFlakyCases,
  // Exported for tests
  _internal: {
    windowStats,
    countSwitches,
    lateFailureIndicator,
    DEFAULT_RECENT_WINDOW,
    DEFAULT_BASELINE_WINDOW,
    MIN_RUNS_FOR_VERDICT,
  },
};
