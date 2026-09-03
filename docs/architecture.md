# Architecture: the six cross-cutting mechanisms

This codebase is a deliberately small Express + Prisma + Postgres app, but
it implements six patterns that real-world apps almost always need. They're
shipped together because they reinforce each other — every meaningful
mutation is captured by the audit log, soft-deleted records stay
recoverable, runs give you history instead of a single "result" field,
invites gate sign-up when you want it gated, the scheduler turns QA into
a continuous background activity instead of a manual chore, and the
Phase-8 executor closes the loop by actually running tests instead of
just tracking whether a human clicked "passed".

| Mechanism        | Where it lives                                | Why it exists                                                      |
| ---------------- | --------------------------------------------- | ------------------------------------------------------------------ |
| **Soft delete + Trash** | `deleted_at` column on `TestCase`/`TestSuite`; `/trash` routes | Recoverable deletes. Mistakes happen; hard `DELETE FROM` is permanent. |
| **Audit log**    | `middleware/withAudit.js`, `AuditEvent` table, `/audit` routes | "Who changed what when?" is the first question after any incident. |
| **Test Runs**    | `TestRun` table, `/runs` + `/test-cases/:id/runs` routes       | A case has many runs over time, not a single "result".            |
| **Invites**      | `Invite` table, `/invites` routes, `REGISTRATION_MODE` env     | Open registration is fine for learning; invite-only is the default for real teams. |
| **Scheduler**    | `ScheduledJob` table, `/scheduled-jobs` routes, `middleware/schedulerLoop.js` | "Run the smoke suite every weekday at 9am" without a human clicking. |
| **Real test execution (Phase 8)** | `utils/executor.js` (Cypress spawn), `utils/runStream.js` (event bus), `routes/execution.js` (`POST /test-cases/:id/execute`, `GET /runs/:id/stream` SSE) | Closes the loop between case authoring and case running. Stored snippets become real Cypress runs that mutate the same `TestRun` table the rest of the dashboard reads from. |

## How they compose

A single `PUT /test-cases/:id` with `{ result: 'passed' }` now:

1. Updates the case row (RBAC-gated, validated).
2. Creates a `TestRun` row (the "result" is now derived from this history).
3. Records an `AuditEvent` with the before/after snapshot.

A `DELETE /test-cases/:id` now:

1. Sets `deleted_at` instead of removing the row.
2. Records an `AuditEvent` with `action: 'case.delete'`.
3. Leaves the row visible in `/trash/cases` until an admin restores or purges it.

A scheduled fire of a suite does the suite-run path, then for each member
case creates a `TestRun` with `status='not_run'` (the test runner that
fills in `passed`/`failed` is the next integration up) and records an
`AuditEvent` with `action='scheduled_job.fire'`.

## What this isn't

- **Not event sourcing.** Audit rows are write-only logs; you can't replay
  them to reconstruct state.
- **Not CQRS.** Reads still hit the same tables as writes.
- **Not a workflow engine.** Audit events are facts, not approvals.
- **Not a real test runner.** Scheduled fires create `TestRun` rows but
  don't execute anything; that integration is one level up.

The point is to teach the *patterns*, not to ship a competing version of
GitHub. Each doc below goes deep on one mechanism.

- [`soft-delete.md`](./soft-delete.md)
- [`audit-log.md`](./audit-log.md)
- [`test-runs.md`](./test-runs.md)
- [`invites.md`](./invites.md)
- [`scheduler.md`](./scheduler.md)

## Where to read the code

```
prisma/schema.prisma                  ← the tables + deleted_at columns
middleware/withAudit.js               ← deferred-send audit middleware
middleware/registrationGate.js        ← REGISTRATION_MODE gate
middleware/schedulerLoop.js           ← in-process tick loop + atomic claim
routes/invites.js                     ← /invites + /invites/redeem
routes/runs.js                        ← /runs + nested /test-cases/:id/runs
routes/trash.js                       ← /trash/cases + /trash/suites
routes/audit.js                       ← /audit + /audit/export.csv
routes/scheduledJobs.js               ← /scheduled-jobs CRUD + run-now
utils/cron.js                         ← cron parser + next-fire algorithm
public/admin.html                     ← Invites section on the admin page
public/invite-redeem.html             ← public page for invitees
public/scheduler.html                 ← Scheduled-job list + form + history modal
```
