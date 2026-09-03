# Test Runs

A **Test Run** is one execution of a test case at one point in time,
with a result (`passed` / `failed` / `not_run`), timestamps, and an
optional note. The historical single-field `TestCase.result` has been
replaced with a derived value: "the most recent run, or `not_run` if
there are none".

## Why runs

A QA team running a regression suite yesterday wants to know "what
happened" — *did case 42 pass or fail, who ran it, when?* A single
`result` field answers only the latest one, and it answers nothing
about *who* or *when*.

With runs:

- You can graph "pass rate over time".
- You can filter "show me everything Alice failed last week".
- You can spot flaky tests (pass/fail/pass/fail in a row).

## How it works

### Schema

```prisma
model TestRun {
  id            Int       @id @default(autoincrement())
  test_case_id  Int
  test_case     TestCase  @relation(fields: [test_case_id], references: [id])
  status        String    @default("not_run")    // not_run | passed | failed
  started_at    DateTime  @default(now())
  finished_at   DateTime?
  duration_ms   Int?
  notes         String?
  run_by_id     Int?
  run_by        User?     @relation("RunsPerformed", fields: [run_by_id], references: [id])
}
```

### Endpoints

| Method | Path                                       | Auth   | Notes                              |
| ------ | ------------------------------------------ | ------ | ---------------------------------- |
| POST   | `/test-cases/:id/runs`                     | write  | Start a run (`status: 'not_run'`) |
| PUT    | `/test-cases/:id/runs/:runId`              | write  | Finish with `{ status, notes }`    |
| GET    | `/test-cases/:id/runs`                     | any    | History for one case               |
| GET    | `/runs/recent?days=7`                      | any    | Dashboard feed                     |

### The shortcut

`PUT /test-cases/:id { result: 'passed' }` still works — it creates a
`TestRun` row with `status='passed'` and `finished_at=now`, then returns
the case with the derived result. Existing UI tests that cycle
`not_run → passed → failed → not_run` keep working without modification.

### Suite "Run all"

`POST /test-suites/:id/run` no longer mutates `TestCase.result` on
every member case. Instead it creates a `TestRun` row per member case,
then returns `{ started: N }`. The dashboard and the suite-detail page
treat this as "ran the suite" without overwriting everyone's history.

### Derived result

Every case response includes `derived_result`:

```json
{
  "id": 42,
  "title": "Login with email",
  "result": "passed",          // legacy field — kept for back-compat
  "derived_result": "passed",   // computed from latest TestRun
  "last_run_at": "2026-08-29T14:21:33.428Z"
}
```

If there are no runs yet, `derived_result === 'not_run'`.

### RBAC

- `GET` (read history) — any authenticated user
- `POST` / `PUT` (start or finish) — admin or editor only
- Viewers get `403` on writes.

## The UI

### Dashboard

A new "Recent runs" section on `/dashboard` reads
`/runs/recent?days=7` and renders a bar chart of pass/fail counts
over the past week.

### Cases + suite-detail

The existing "Run" / "Run all" buttons still work. They hit the
shortcut endpoint (one `PUT`), which creates a run. The UI then
re-reads the case so the derived result updates.

## Tests

- `cypress/e2e/api/07-runs.cy.js` — 10 tests: start, finish, history,
  recent, suite "Run all" creates per-case runs, viewer denied on
  writes, invalid status returns 400.

The most important contract: **the shortcut `PUT /test-cases/:id {
result: 'X' }` still works AND now creates a `TestRun` row.** Test
"PUT /test-cases/:id with result='passed' creates a TestRun row" is the
one that locks that contract in.
