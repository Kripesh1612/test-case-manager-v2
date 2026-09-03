# Flakiness Detector

The Test Case Manager scores every test case on a 0–100 flakiness scale
and labels it with one of six categorical verdicts. The score is computed
from the case's recent `TestRun` history; the verdict drives the UI
badges, the dashboard widget, and the per-case detail panel.

---

## The score (0–100)

Three signals are blended with fixed weights:

| Signal         | Weight | What it measures                                                    |
|----------------|--------|---------------------------------------------------------------------|
| `disagreement` | 40 | `|p_recent - p_baseline|`. How far the recent pass rate has drifted from the baseline window. If baseline has fewer than 3 runs, falls back to `(1 - p_recent)` — i.e. raw recent failure rate. |
| `switch_rate`  | 30 | `alternations / (window_size - 1)` over the recent window. Pure alternation `P F P F …` gives 1.0. |
| `late_failure`  | 30 | 1.0 if the most-recent run failed after a streak of 3+ passes; 0.5 if the streak was 1–2 passes; 0 if the last run passed. |

Raw score = `40·disagreement + 30·switch_rate + 30·late_failure`,
clamped to `[0, 100]` and rounded to one decimal.

---

## Verdicts

The score is mapped to a verdict with a structural override for regressions:

```
score ≥ 75           →  very_flaky
50 ≤ score <  75     →  flaky
25 ≤ score <  50     →  possibly_flaky
score  <  25         →  stable
                      ── (structural override below) ──
recent.failed ≥ 5 AND recent.passed == 0
  AND baseline.length ≥ 3 AND baseline.pass_rate ≥ 0.7
                    →  broken
finished_runs < 5   →  insufficient_data
```

The `broken` override fires when the recent window is all-fail after a
previously-stable baseline. That's a regression — not a flake. Flakes
recover; regressions don't, until someone fixes the case.

`insufficient_data` is returned verbatim whenever a case has fewer than
5 finished runs. Mark a case passed/failed a few more times and the
score will appear.

---

## Windows

Two windows are computed, both newest-first:

| Window   | Size  | Used for                                |
|----------|-------|-----------------------------------------|
| `recent`   | 10 runs | disagreement (as the numerator), switch_rate, late_failure |
| `baseline` | 20 runs | disagreement (as the reference)         |

Each window returns `{ window_size, passed, failed, pass_rate }`. The
baseline window is allowed to be smaller than 20 — if the case has only
ever been run 7 times, baseline is just those 7 older runs.

Only runs with a finished status (`passed` / `failed`) count. `not_run`
runs (cases that were queued but never executed) are filtered out before
any computation.

---

## The algorithm in pseudocode

```js
function analyzeFlakiness(caseId, runs /* newest-first */) {
  const finished = runs.filter(r => r.status !== 'not_run');
  if (finished.length < 5) return { verdict: 'insufficient_data', ... };

  const recent   = finished.slice(0, 10);
  const baseline = finished.slice(10, 30);

  const disagreement = baseline.length >= 3
    ? Math.abs(recentPassRate(recent) - recentPassRate(baseline))
    : 1 - recentPassRate(recent);

  const switchRate = countSwitches(recent) / Math.max(1, recent.length - 1);

  const lateFailure = lateFailureIndicator(recent);

  const score = clamp(40 * disagreement + 30 * switchRate + 30 * lateFailure, 0, 100);

  const verdict = recentIsAllFail() && baselineIsStable()
    ? 'broken'
    : score >= 75 ? 'very_flaky'
    : score >= 50 ? 'flaky'
    : score >= 25 ? 'possibly_flaky'
    : 'stable';

  return { case_id, score, verdict, recent, baseline, signals, ... };
}
```

`utils/flakiness.js` is the live implementation. It's a pure function on
`(caseId, runs, opts)` so the algorithm is unit-testable and the DB-free
branch can be benchmarked without Postgres.

---

## Endpoints

```
GET /test-cases/flaky?threshold=N        →  list cases above threshold
GET /test-cases/:caseId/flakiness        →  full report for one case
```

Both require authentication. The full report has the per-signal
breakdown; the list endpoint is the dashboard's data source.

### `GET /test-cases/flaky?threshold=N`

Query params:
- `threshold` (number, 0..100, default 50) — minimum score to include

Response:

```json
{
  "threshold": 50,
  "count": 1,
  "cases": [
    {
      "case_id": 1917,
      "title": "Login flow with valid creds",
      "score": 65,
      "verdict": "flaky",
      "sample_size": 10,
      "last_run_status": "failed"
    }
  ]
}
```

The list is sorted by score descending. Threshold defaults to 50
(verdict `flaky`); pass `25` to include `possibly_flaky` candidates.

### `GET /test-cases/:caseId/flakiness`

Response:

```json
{
  "case_id": 1917,
  "score": 65,
  "verdict": "flaky",
  "sample_size": 10,
  "recent":   { "window_size": 10, "passed": 5, "failed": 5, "pass_rate": 0.5 },
  "baseline": { "window_size":  0, "passed": 0, "failed": 0, "pass_rate": 0    },
  "signals": {
    "disagreement": 0.5,
    "switch_rate":  1.0,
    "late_failure":  0
  },
  "last_run_at":      "2026-08-31T14:55:01.000Z",
  "last_run_status":  "failed"
}
```

404 if the case is unknown or soft-deleted.

---

## Performance

The single-case endpoint is O(1) — one indexed scan over the most
recent 30 runs for that case.

The list endpoint is O(N) over all non-deleted cases — it scores every
case and sorts. On a 30-case DB it runs in ~1s; on a 300-case DB expect
~10s. For larger workspaces, replace `findFlakyCases` with a windowed
PG function that returns only candidates above a coarse pre-filter.

---

## UI

Three presentation layers over the same data:

- **`<FlakinessBadge>`** — a compact pill rendered next to each row on
  the case list page. Hidden when verdict is `stable` or
  `insufficient_data` (so clean cases don't add visual noise). Click it
  to navigate to the case detail.
- **`<FlakinessPanel>`** — full report on the case detail page: score
  gauge, verdict, three signal cards with per-signal bars, recent + baseline
  window stats, and the last-run timestamp.
- **`<FlakyCasesCard>`** — top-10 dashboard widget fed by the list
  endpoint. Shows the case title, score, and a coloured verdict pill.

All three components share a single `verdictPalette()` so colour
semantics stay consistent: green for `stable`, amber for
`possibly_flaky`, orange for `flaky`, red for `very_flaky`, rose for
`broken`, grey for `insufficient_data`.

---

## Algorithm references

- **Rolling-window statistics** — recent vs baseline two-sample.
- **Alternation / run-length encoding** — switch_rate as a coarse proxy
  for sequence noise. A full alternation pattern is the textbook flake
  signature.
- **Two-proportion comparison** — disagreement is the absolute
  difference of pass rates. A coarse proxy for the chi-squared /
  binomial two-proportion test, without the strict asymptotic
  assumptions.