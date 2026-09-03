# Scheduler — cron-based test execution

The scheduler is the "run the smoke suite every morning at 9am" subsystem. It
lets an admin attach a 5-field cron expression to a test suite; the loop fires
the suite on schedule, creates one `TestRun` row per member case, and records
the fire event in the audit log.

## Why it exists

The rest of the app is reactive — humans click buttons and records change. The
scheduler turns QA into a continuous background activity: the smoke suite
fires at 9, regression fires at midnight, and the audit log tells you exactly
when each suite last ran without anyone having to remember to click.

It also demonstrates the parts of a real back-end job system that a class
project usually skips:

- **a non-trivial algorithm** — a real cron parser with Vixie DOM/DOW
  semantics and bounded search for next-fire-time
- **atomic concurrency** — optimistic-claim via `UPDATE … WHERE
  next_run_at = X` so two ticks can't double-fire the same job
- **bounded retry with exponential backoff + jitter** — what happens when
  the suite's cases have been deleted, or the DB hiccups mid-fire

## What the user sees

A new top-level tab **Scheduler** in the app. Three things on the page:

1. **A list of all scheduled jobs**, each row showing the cron expression,
   target suite, next fire time (relative + absolute on hover), last fire
   time, and a status badge (`enabled` / `disabled` / `error`). Errors
   show the last exception text as a tooltip.
2. **+ New Scheduled Job** opens a form: name, cron expression, timezone
   (display-only — cron fields are always interpreted as UTC), suite
   dropdown, max retries. A live preview under the cron field shows the
   humanized form (e.g. `0 9 * * 1-5` → "Weekdays at 9am") so typos are
   caught before submit.
3. **Per-row actions**: Run now (manual fire), Enable/Disable toggle,
   History (last 25 fires from the audit log), Delete.

## API

All routes are under `/scheduled-jobs`. Admin-only for mutations; any
authenticated user can read.

| Method | Path                          | Role         | Purpose                                          |
| ------ | ----------------------------- | ------------ | ------------------------------------------------ |
| GET    | `/scheduled-jobs`             | any auth     | List all jobs (newest-enabled first)             |
| POST   | `/scheduled-jobs`             | admin        | Create. Computes `next_run_at` from the cron     |
| GET    | `/scheduled-jobs/:id`         | any auth     | Read one                                         |
| GET    | `/scheduled-jobs/:id/history` | any auth     | Last 25 `scheduled_job.fire` audit events        |
| PATCH  | `/scheduled-jobs/:id`         | admin        | Update. Recomputes `next_run_at` if cron changes |
| DELETE | `/scheduled-jobs/:id`         | admin        | Delete                                           |
| POST   | `/scheduled-jobs/:id/run`     | admin        | Fire the suite immediately, bypassing the schedule |

### Request bodies

Create:
```json
{
  "name": "Weekday smoke",
  "cron": "0 9 * * 1-5",
  "timezone": "UTC",
  "suite_id": 12,
  "max_retries": 2
}
```

Update — every field optional:
```json
{ "cron": "*/15 * * * *", "enabled": false }
```

### Cron validation

The cron field is run through `utils/cron.isValid()` on the way in, so the
same code that computes `next_run_at` is the source of truth for validity.
A bad expression returns `400 Validation failed` with a `details[]` entry
identifying `cron` as the offender.

## Cron parser

`utils/cron.js` is a ~100-line zero-dependency implementation of the Vixie
cron format:

```
minute  hour  day-of-month  month  day-of-week
 0-59   0-23     1-31        1-12      0-6   (0 = Sunday)
```

Each field accepts `*`, `N`, `*/N`, `A-B`, and comma-separated unions.

### DOM/DOW semantics

Per `man 5 crontab`:

- both `*`        → any day matches (always true)
- one restricted  → the restricted field alone decides (AND)
- both restricted → either field matching fires (OR — "the surprising one")

The last case is the Unix convention most users expect. We follow it
explicitly rather than substituting a "smarter" interpretation that would
surprise anyone who's written a crontab before.

### Next-fire-time

`nextFire(parsed, after)` walks forward one minute at a time until it finds
a match. Worst case is bounded to one year (~530k steps, single-digit ms)
which is fine for a once-per-minute background tick. The function returns
`null` if no match is found within that bound — the caller treats that as
a validation error rather than crashing.

## The scheduler loop

`middleware/schedulerLoop.js` runs in-process — no Redis, no separate worker.
That's deliberate: for a single-app test manager the operational cost of a
queue isn't worth the throughput gain.

### Public API

```js
const { startScheduler, stopScheduler, tick, executeJob, recomputeAllDue } = require('./middleware/schedulerLoop');
```

| Function            | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `startScheduler()`  | Start the tick interval. Called once at boot.                 |
| `stopScheduler()`   | Clear the interval. Called on SIGINT/SIGTERM.                 |
| `tick()`            | Run one tick synchronously. Used by tests; the loop calls it |
|                     | on a setInterval.                                             |
| `executeJob(job)`   | Fire one job synchronously. Used by both the loop and the    |
|                     | manual `/run` route, so the two paths can never drift.        |
| `recomputeAllDue()` | Backfill `next_run_at` on jobs that lack one (e.g. first boot |
|                     | after a deploy).                                              |

The loop interval defaults to 60 seconds (override via `SCHEDULER_TICK_MS`).
Set `SCHEDULER_DISABLED=1` to short-circuit start entirely (useful in CI).

### Concurrency model

Optimistic-claim. Each tick finds candidates where `next_run_at <= now OR
retry_at <= now`, then for each one does:

```sql
UPDATE scheduled_jobs
SET    next_run_at = <next computed>, retry_at = NULL
WHERE  id = $1 AND next_run_at = <value we just read>
```

If the WHERE doesn't match (because another tick, or an admin's PATCH,
already moved the row) the UPDATE affects 0 rows and we silently skip.
This is what guarantees a slow suite can't be double-fired even if the
tick interval drifts.

### Retry policy

On failure, the job's `retry_count` increments and `retry_at` is set to:

```
now + min(2^retry_count minutes, 60 minutes) + random(0–30s jitter)
```

Once `retry_count > max_retries`, the job stays in an error state — no
automatic resurrection — and an admin has to intervene. The `last_error`
column captures the exception text (truncated to 1000 chars).

`max_retries = 0` means "no retries; first failure is final." That's the
right default for new users who haven't tuned it.

### Disabling mid-fire

Disabling a job does NOT cancel an in-flight execution. The current tick
continues; the job simply stops being a candidate for future ticks. If you
want to pause cleanly, the right move is `PATCH enabled=false` and wait for
the next tick — or `POST /:id/run` doesn't have an equivalent either;
manual fires can't be cancelled.

## Data model

```prisma
model ScheduledJob {
  id            Int       @id @default(autoincrement())
  name          String
  cron          String    // 5-field cron expression (UTC)
  timezone      String    @default("UTC")     // display only
  suite_id      Int
  suite         TestSuite @relation(fields: [suite_id], references: [id], onDelete: Cascade)
  enabled       Boolean   @default(true)
  last_run_at   DateTime?
  next_run_at   DateTime? // computed on create/update and after each fire
  retry_count   Int       @default(0)
  max_retries   Int       @default(0)
  retry_at      DateTime? // when set, overrides next_run_at for the next fire
  last_error    String?
  created_by_id Int
  created_by    User      @relation("CreatedScheduledJobs", fields: [created_by_id], references: [id])
  created_at    DateTime  @default(now())
  updated_at    DateTime  @updatedAt

  @@index([enabled, next_run_at])
  @@index([enabled, retry_at])
  @@map("scheduled_jobs")
}
```

Two indexes: `(enabled, next_run_at)` and `(enabled, retry_at)` — both
serve the same hot-path query in the tick loop and let Postgres skip a
table scan even with thousands of disabled jobs.

## Failure modes worth knowing

- **Suite is deleted while a job points at it.** `executeJob` treats that
  as a thrown error, the retry policy kicks in, the row gets `last_error`
  populated. After `max_retries` it sits in error state.
- **All cases in the suite are soft-deleted.** No `TestRun` rows are
  created (because there are no member cases to create them for). The
  fire is still recorded as a successful no-op in the audit log.
- **Scheduler crashes mid-tick.** The interval timer is `unref()`'d so it
  doesn't keep the process alive. On restart, `recomputeAllDue` backfills
  any null `next_run_at`, and the next tick picks up whatever's due.
- **Clock skew between the app and the DB.** `next_run_at` is stored in
  Postgres timestamp; the tick compares it to `new Date()` from the app.
  For small skew this is harmless (the job just fires a few seconds late).
  For large skew (>1 min), an admin should re-disable/re-enable the job
  to recompute `next_run_at` from "now".

## Tests

Two Cypress files cover the surface end-to-end:

- `cypress/e2e/api/09-scheduler.cy.js` — 15 tests. RBAC (admin-only on
  mutations), validation (bad cron, missing fields, bad suite_id,
  max_retries cap), CRUD, run-now (which actually creates `TestRun` rows
  per case), update that recomputes `next_run_at`, disable/re-enable that
  clears retry state, history endpoint, delete.
- `cypress/e2e/ui/08-scheduler.cy.js` — 7 tests. Page renders, form opens
  with cron-preview, job created and visible, run-now fires and toasts,
  history modal opens, toggle persists across reloads, delete via confirm
  modal, viewer role hides admin-only buttons.

## Design notes / things to call out

- **Why a custom cron parser instead of `cron` or `node-cron`.** Both npm
  packages are battle-tested but have surface area we don't need and a
  parse-failure shape that doesn't tell us *why* the expression was bad.
  ~100 lines for something this small is a fair trade.
- **Why UTC instead of real timezones.** Cron fields don't carry timezone
  information; doing real TZ math correctly requires either `luxon` or
  `moment-tz`, neither of which we want as a dep. The `timezone` column
  is preserved for display purposes (an admin can read the value and
  know what TZ the human was thinking in) but it doesn't affect fire
  times. This is documented in the UI ("Timezone (display only; cron
  fields are UTC)").
- **Why optimistic-claim instead of `SELECT … FOR UPDATE SKIP LOCKED`.**
  Postgres would do the right thing with the latter, but Prisma's
  transaction API makes it cumbersome. `updateMany` with a WHERE that
  encodes "the value I just read" gives the same guarantee with one
  round-trip, no transaction, and works on every Prisma-supported DB.
- **Why per-case `TestRun` rows instead of one summary row.** The
  `TestRun` table is already the source of truth for "this case ran at
  this time, with this result." A scheduled fire looks identical to a
  manual one from the dashboard's POV — both produce a row per case,
  with `status='not_run'` for scheduled fires (because we don't have a
  real test result; that's what a future integration with a test runner
  would populate). This avoids a separate data model.
