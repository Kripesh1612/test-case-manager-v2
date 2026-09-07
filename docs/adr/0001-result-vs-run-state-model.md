# ADR-0001 — TestCase.result vs TestRun.status

- Status: Accepted
- Date: 2026-09-07
- Supersedes: —
- Related: [`docs/test-runs.md`](../test-runs.md), [`utils/serialize.js`](../../utils/serialize.js), [`utils/executor.js`](../../utils/executor.js)

## Context

A test case has two natural states:

1. The **result of its last execution** — `passed`, `failed`, `errored`,
   `not_run`. Useful for "did this case ever work?" and for any UI that
   surfaces a green/red badge next to the case.
2. The **history of every execution** — a time-series of when the case
   was run, by whom, how long it took, what its exit code was, what the
   failure log said. Useful for flakiness scoring and regression
   analysis.

The original schema (pre–Phase 7) conflated both into one column:

```prisma
result  String  @default("not_run")  // not_run | passed | failed
last_run_at DateTime?
```

That single column served the badge well, but it answered nothing about
*when* the result was last observed, *who* ran it, or *why* it failed.
Phase 7 introduced `TestRun` to carry that history. The question this
ADR resolves is: **what does `TestCase.result` mean now that `TestRun`
exists?**

## Decision

`TestCase.result` continues to exist, but it is **derived state**, not
authoritative state. The authoritative record is `TestRun.status` for
the most-recently-finished run. The mirror writes happen in two places:

1. **Real executions** — `utils/executor.js#finalize()` stamps
   `TestCase.result` to `'passed'` or `'failed'` when the child
   Cypress process exits with a matching outcome. `'errored'` is
   intentionally **not** mirrored: an executor crash (binary missing,
   disk full, network blip) should not flip a previously-passing case
   red. `last_run_at` is always updated alongside `result`.

2. **UI click handlers** — the legacy "I just ran this manually, here's
   the result" affordance in `PUT /test-cases/:id` writes a `TestRun`
   row and stamps `TestCase.result` in the same transaction. This
   preserves the original UX (set result, see badge update) while still
   keeping a row in `test_runs` so the run appears in history.

Reads do **not** consult `TestRun.status` to compute `TestCase.result`
on the fly. The mirror is the source of truth on the read path. This
keeps the hot list endpoint (`GET /test-cases`) a single-table query
with no joins, which matters when the project hits the few-thousand-cases
mark. The trade-off is that the two can drift in the (rare) window
between a `TestRun` insert and its terminal-status update; the executor
mitigates this by writing the mirror in the same code path as the
`TestRun` finalization, so the drift window is bounded by transaction
latency on a single Prisma client.

## Consequences

Positive:

- `GET /test-cases` stays cheap — no subquery, no join, no aggregate.
- The badge in the UI is one column read.
- History is fully preserved in `TestRun`; purging the mirror via
  `TestCaseVersion`-style versioning does not lose any run data.

Negative:

- Two columns to keep in sync. We accept this because the alternative
  (always derive on read) costs latency on the list endpoint, and
  write-time mirroring is a single extra `prisma.testCase.update` per
  run finalization.
- Restoring a `TestCase` from a `TestCaseVersion` snapshot does not
  restore `result` or `last_run_at` — those are execution metadata, not
  content. This is documented in the snapshot helper.
- The "I want to know why the last run failed" question still requires
  a second query into `TestRun.error_log` or `notes`. That is
  intentional — the badge is a state, the failure detail is a story.

## Alternatives considered

- **Drop `TestCase.result` entirely.** Compute it on read by joining
  `TestRun`. Rejected: the list endpoint becomes a per-row correlated
  subquery, and the existing UI assumes a single column. Migration cost
  is high for marginal benefit.
- **Make `TestCase.result` a generated/computed column in Postgres.**
  Rejected: Prisma's generated columns are not first-class, and we want
  the option to write `result` directly (the UI click-handler case)
  without a `TestRun` row being the only way to flip it.
- **Reverse the mirror — store `last_run_status_id` on `TestCase` and
  join.** Rejected: same complexity cost as the "drop and join" option,
  with no upside.

## Follow-ups

- When flakiness scoring starts trending cases as "stale", we should
  surface `last_run_at` in the badge tooltip so users can tell *when*
  the result was last observed — not just *what* it was.
- If Prisma ever lands a first-class generated-column API, revisit
  the "drop and join" alternative.
