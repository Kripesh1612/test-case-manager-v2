# Real test execution (Phase 8)

> Phase 8 closes the loop between authoring a case and running it.
> Until now, `TestRun.status` was set by a human clicking "passed" or
> "failed". Phase 8 spawns Cypress for real and records the result.

## What changed

| Surface | Before | After |
| --- | --- | --- |
| `TestCase` | no snippet field | nullable `executable_snippet` |
| `TestRun.status` | `not_run \| passed \| failed` | adds `running` (in flight) and `errored` (executor crashed) |
| `TestRun` telemetry | `duration_ms`, `notes` | adds `assertion_count`, `exit_code`, `error_log` (last 4 KB), `started_via` |
| Run origin | `run_by_id` only | `started_via`: `manual` (today), `scheduled` (Phase 9) |
| Browser | — | bundled `electron` (no Chrome dependency) |

## Endpoints

### `POST /test-cases/:id/execute`

Editor/admin only. Returns `201` with the freshly-created `TestRun` row
(status `running`) and fires the executor in the background. The
request returns immediately so the UI can open the SSE stream.

Errors:
- `400` — case has no `executable_snippet`
- `404` — case not found
- `403` — viewer role
- `401` — not authenticated

### `GET /runs/:id/stream`

Server-Sent Events feed. Open with a Bearer token in the `Authorization`
header (the client uses `fetch` since `EventSource` can't set custom
headers).

Frames:

```
event: snapshot
data: {"runId": 12, "status": "running"}

event: stdout
data: "  ...cypress output...\n"

event: progress
data: {"phase": "starting"}

event: done
data: {"status": "passed", "assertionCount": 3, "exitCode": 0, "durationMs": 12345}
```

The stream closes automatically when the `done` event fires.

## The loop

1. User pastes a Cypress snippet into a case (or pushes a new one via
   `PUT /test-cases/:id { executable_snippet }`).
2. User clicks **Run** on the case detail page.
3. The client posts to `/execute`, captures the returned `id`, then
   opens a `fetch()` stream to `/runs/:id/stream`.
4. The server writes the generated spec to `storage/runs/<id>/spec.cy.js`,
   spawns the bundled Cypress binary (Electron browser, `--reporter
   json`), and pipes child stdout/stderr to the stream.
5. On child exit the executor parses `result.json`, classifies the run
   into `passed | failed | errored`, writes it to `TestRun`, and emits
   `done`.
6. The flakiness detector consumes the new row as it would any other
   `TestRun` — no schema or algorithm changes were needed.

## Artifacts

Everything is on disk under `storage/runs/<runId>/`:
- `spec.cy.js` (deleted after the run exits)
- `result.json` (Cypress's JSON reporter output, kept for debugging)
- `stdout.log` / `stderr.log` (last 64 KB each, only if non-empty)

Pull out a failing run later with:

```bash
cat storage/runs/$(id)/stdout.log
cat storage/runs/$(id)/result.json | python3 -m json.tool
```

## What's deferred

- **Structured step DSL** — Phase 8 keeps `steps[]` as free-text for
  documentation. The server runs whatever Cypress snippet the user
  pastes; it does not translate steps into commands.
- **Per-step screenshots / video playback** — Cypress supports both;
  surfacing them in the UI needs a viewer component. Trivial to add.
- **Bull + Redis queue** — single-process is fine for one or two
  concurrent runs. Swap behind the same `executeCase(caseId, runId)`
  interface when needed.
- **Scheduler integration** — when the scheduler fires a suite, the
  next phase will have it call `executeCase()` per member case.
- **Watch mode** — repeated runs of the same case for live diagnosis.
