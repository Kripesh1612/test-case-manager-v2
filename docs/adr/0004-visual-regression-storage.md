# ADR-0004 — Visual regression: per-run diff storage, no baseline vault

- Status: Accepted
- Date: 2026-09-17
- Supersedes: —
- Related: [`docs/visual-regression.md`](../visual-regression.md), [`utils/visualDiff.js`](../../utils/visualDiff.js), [`utils/artifactStore.js`](../../utils/artifactStore.js), [`routes/visual.js`](../../routes/visual.js), [`utils/executor.js`](../../utils/executor.js)

## Context

A Cypress run can capture screenshots — sometimes many, depending on the
suite. The question this ADR answers is: *what does the project do with
them, beyond letting the runner clean them up at the end?*

Three plausible designs show up in other tools:

1. **Baseline-vault model.** A repo-side (or admin-side) golden image per
   `(case, viewport, browser, build-hash)` tuple. Every run is diffed
   against the baseline, the baseline is promoted by a manual "Accept"
   button. This is what Percy / Chromatic / Loki / reg-suit do.
2. **Per-run self-diff.** No baseline. The two screenshots being diffed
   come from *the same run* (e.g. before and after a state change).
   The diff is a side-channel signal, not a gate.
3. **Frame-difference on video.** Capture a video of the run, compare
   consecutive frames, flag sequences with high motion. Useful for
   layout-shift detection, not for visual-regression in the Percy sense.

The first is heavyweight (goldens to store, hash strategy, promotion
workflow, viewport matrix) and the third requires video encoding we don't
do. We picked the second: keep it as a *signal stored alongside the run*,
not as a gate. This ADR captures that decision and the four
implementation axes that fall out of it.

## Decision

### 1. Per-run, before-vs-after only — no baseline vault

`utils/executor.js` points Cypress's `screenshotsFolder` at
`storage/runs/<runId>/screenshots`. After the run finishes,
`attachVisualResults(runId)` reads the **first** and **last** screenshot
the run produced and diffs them. The result (`diff_score`,
`diff_image`, before/after names) is stamped on the `TestRun` row and
never recomputed automatically.

The deliberate omission: there is **no admin UI for promoting a
screenshot to a baseline**. A future "compare this run against last
green run" feature can be added by adding columns / endpoints *without*
re-architecting the storage layer — the artifacts already live in
per-run directories keyed by run id.

### 2. Filesystem under `storage/runs/<runId>/`, gitignored

All screenshots land under `<projectRoot>/storage/runs/<runId>/`. The
`storage/` tree is `.gitignore`d. There is one `artifactDir(runId)`
helper in `utils/artifactStore.js`; every read and write goes through
it. A future S3 backend only has to override four functions.

The pre-existing Phase 8 issue — `tcm-app` container couldn't write
`/app/storage/runs` without `mkdir -p /app/storage && chown tcm:tcm
/app/storage` in the Dockerfile — is documented in
[`docs/security-model.md`](../security-model.md) and tracked as a
follow-up. Visual storage inherits the same constraint because it
shares the same root.

### 3. Artifact names are caller-chosen, traversal-guarded on serve

`POST /runs/:id/artifacts/:name` lets the runner attach any base64 PNG
under a caller-supplied name. The name regex is `/^[A-Za-z0-9._-]+$/`,
so no slashes, no `..`. The serve endpoint
`GET /runs/:id/artifacts/{*name}` re-resolves the path through
`artifactPath()` which refuses to escape `<runDir>/`.

Convention (not enforced): the runner uploads `artifacts/before.png`
and `artifacts/after.png`, then calls `/visual/diff`, which writes
`artifacts/diff.png` (the highlight image from `pixelmatch`). Any
override of `screenshot_before`/`screenshot_after` columns is honored
on the next diff.

### 4. Thresholds: `0` / `0 < s ≤ 0.05` / `s > 0.05`

`diffScoreToVerdict(score)` maps `pixelmatch`'s 0..1 ratio to one of
three buckets:

| `diff_score`     | verdict       |
|------------------|---------------|
| `0`              | `identical`   |
| `0 < s ≤ 0.05`   | `minor`       |
| `s > 0.05`       | `significant` |

`0.05` matches what teams typically consider "catching a regression":
sub-1% pixel drift is anti-aliasing noise from font rendering, >5% is
usually a real change.

The verdict is **not** a gate — a run can pass with `verdict =
'significant'` and fail with `verdict = 'identical'`. The diff is a
signal stored alongside, not a replacement for, the behavioural
result. This matches the explicit hardening note at the bottom of
`docs/visual-regression.md`.

## Consequences

Positive:

- **Zero new deps beyond `pixelmatch`.** `pngjs` was already a
  transitive dep. The `utils/visualDiff.js` module is ~90 LOC and is
  exercised by 8 unit cases that synthesize tiny PNGs in-process — no
  fixture files, no binary blobs in git.
- **Cheap to add later.** If a future "compare to last green" feature
  is wanted, the storage layout already supports it (read two runs'
  `before.png` and diff). The only addition is a route + a UI tab.
- **Path-traversal closure.** The name regex + path resolution guard
  is a 4-line cost and closes the class of attacks where a crafted
  `?name=../../etc/passwd` could read host files.

Negative:

- **No cross-run regression detection today.** This is a per-run
  diff, not a baseline diff. A run that consistently produces a 30%
  diff against the same starting state will pass every time because
  *both* the before and after are wrong. We accept this because the
  primary failure surface is *behavioural* (test assertions), and
  visual drift on a single run is still surfaced as data an admin
  can inspect.
- **Filesystem is a single-node store.** Horizontal scale-out (multiple
  API replicas behind a load balancer) won't share `storage/`. The
  mitigation is the same as for run-result JSON: an S3 backend swap
  is a 4-method override of `artifactStore.js`.
- **Phase 8 storage permission issue carries over.** The `tcm-app`
  container needs `/app/storage` to be writable by the `tcm` user;
  otherwise any visual diff errors with `EACCES`. This is a known
  pre-existing issue, not something this ADR introduces.

## Alternatives considered

- **Percy-style baseline vault with promotion.** Strong story for
  catching regressions, but the operational weight (golden-image
  storage, hash strategy, viewport matrix, "accept" workflow, branch
  vs main baselines) is the right size for a dedicated visual
  service. For a CS capstone project that already runs Cypress
  directly, the per-run diff captures the *useful* signal (visual
  drift *within* a single run) without the vault.
- **Compare against the previous run's `after.png`.** Tempting — it's
  one column away. Rejected because it conflates "this run looks
  different from the last green" with "this run changed a lot
  internally." A failed run where the page never renders would still
  compare to last green's `after.png` and report a huge diff, which
  is *correct* but for the wrong reason. Per-run before-vs-after
  keeps the question well-scoped.
- **Cloud-side visual diff (e.g. via the dashboard's screenshots).**
  Out of scope — the dashboard is read-only data, not a diff engine.
- **Frame-diff on video.** Requires video encoding + ffmpeg
  dependency. Not justified by the project size.

## Follow-ups

- The Phase 8 storage-permission fix (Dockerfile
  `mkdir -p /app/storage && chown tcm:tcm /app/storage`) should be
  folded in alongside the visual-diff feature, since they share the
  same filesystem root.
- A future "compare to last green" feature would add a single
  `GET /visual/compare?runA=…&runB=…` endpoint reading two
  `before.png` files; no schema change needed.
- When the project moves to S3 (or equivalent), `artifactStore.js` is
  the only file that changes; routes and tests stay put.
