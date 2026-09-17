# Visual regression diffs (Feature 3)

Every run that captures two or more screenshots gets a pixel diff. This is a
deliberately lightweight facility — no base-image vault, no CI-side golden
store. Instead:

- `utils/executor.js` points Cypress's `screenshotsFolder` at
  `storage/runs/<id>/screenshots`.
- After the run finishes, `attachVisualResults(runId)` diffs the **first** and
  **last** screenshot.
- The immutable result (`diff_score`, `diff_image`, screenshot names) is
  stamped on the `TestRun` row and never recomputed automatically.

## Where it shows up

- `POST /runs/:id/artifacts/:name` — attach a base64 PNG (admin). The name is
  restricted to `artifacts/<file>.png` and validated against `SAFE_NAME` and a
  path-traversal guard.
- `POST /runs/:id/visual/diff` — compute the diff between the run's before and
  after screenshots (admin). Before/after default to
  `artifacts/before.png` + `artifacts/after.png`.
- `GET /runs/:id/visual` — diff summary + artifact URLs (admin/editor).
- `GET /runs/:id/artifacts/{*name}` — serve a stored artifact (admin/editor).
- `GET /visual/runs` — runs with a stored diff, newest first (admin/editor).
- UI: the **Visual** page at `/visual` renders the run list and a three-way
  before/after/diff viewer.

## The scoring model

`utils/visualDiff.js` uses `pngjs` + `pixelmatch`:

| diff_score      | verdict     |
|-----------------|-------------|
| `0`             | `identical` |
| `0 < s < 0.02`  | `minor`     |
| `>= 0.02`       | `significant` |

`diff_score` is the fraction of differing pixels (0..1). Screenshots of
different sizes are resized to the smaller before comparing.

- **Unit tests** — `utils/visualDiff.test.js` (8 cases: identical buffers,
  single-pixel changes, resize, verdict thresholds, PNG round-trip).
- **API tests** — `cypress/e2e/api/15-visual.cy.js` (RBAC, upload, diff,
  list, artifact serving, traversal refusal).
- **UI test** — `cypress/e2e/ui/14-visual.cy.js`.

> Hardening note: screenshot comparison is a *signal*, not a judgment. Runs
> that fail for behavioural reasons still count as failed regardless of the
> diff score — the diff is stored alongside, not in place of, the result.