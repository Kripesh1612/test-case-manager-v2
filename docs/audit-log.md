# Audit log

Every meaningful mutation writes a row to `audit_events` with the
actor, action, target, IP, user-agent, and a metadata blob. The
`/audit` endpoint lists them with filters; `/audit/export.csv` dumps
the result as CSV for offline review.

## Why an audit log

After any incident — "the case titles look wrong", "the role changed
by itself", "this user can't see anything anymore" — the first
question is **who did what when**. An audit log answers that in
seconds, without having to grep logs or pull backups.

The audit log isn't meant to reconstruct state (that's event sourcing).
It's a forensic timeline: facts, not commands.

## What's recorded

Anything that creates, updates, or deletes a case, suite, user, run,
or invite. Reads (GET) are **not** logged — that's a different feature
(access log).

| `action`         | `target_type` | When                                          |
| ---------------- | ------------- | --------------------------------------------- |
| `case.create`    | `test_case`   | `POST /test-cases`                            |
| `case.update`    | `test_case`   | `PUT /test-cases/:id`                         |
| `case.delete`    | `test_case`   | `DELETE /test-cases/:id` (soft)               |
| `case.restore`   | `test_case`   | `POST /trash/cases/:id/restore`               |
| `case.purge`     | `test_case`   | `DELETE /trash/cases/:id`                     |
| `suite.create`   | `test_suite`  | `POST /test-suites`                           |
| `run.start`      | `test_run`    | `POST /test-cases/:id/runs`                   |
| `run.finish`     | `test_run`    | `PUT /test-cases/:id/runs/:runId`             |
| `user.create`    | `user`        | `POST /auth/register`                         |
| `user.role`      | `user`        | `PUT /users/:id/role`                         |
| `invite.create`  | `invite`      | `POST /invites`                               |
| `invite.revoke`  | `invite`      | `DELETE /invites/:id`                         |

## How it works

### `middleware/withAudit.js`

`withAudit(action, targetType, options)` is an Express middleware that
wraps a route handler. The pattern:

1. Override `res.status()` and `res.json()` to capture the status code
   and response body.
2. Let the handler run.
3. On response finish, if the status was 2xx, write an `AuditEvent`.

Captured before/after is packed into a single `metadata` Jsonb column —
native Postgres JSON, no string round-trip:

```json
{
  "method": "PUT",
  "path": "/test-cases/42",
  "before": { "title": "Old title", "priority": "low" },
  "after": { "title": "New title", "priority": "low" }
}
```

### Why the deferred-send pattern

A simpler design would be: handler returns, then middleware writes the
audit row, then `next()`. That works for successes but breaks on errors
— the handler might `throw`, and the audit row never gets written.

The deferred-send pattern captures the response *before* the handler
returns, so we have the full picture when we log.

### Disabling it

Set `AUDIT_ENABLED=false` in `.env` to skip the writes. The middleware
becomes a no-op; reads from `/audit` still work against whatever rows
already exist. Useful in tests if you want a quieter DB.

## Reading the log

### `GET /audit`

Admin-only. Supports filters:

```bash
curl -H "Authorization: Bearer $ADMIN_TOKEN" \
  'http://localhost:3001/audit?actor=3&target_type=test_case&target_id=42'
```

Query params:

- `actor` — numeric user id
- `target_type` — `test_case`, `test_suite`, `user`, `invite`, `test_run`
- `target_id` — numeric target id
- `from`, `to` — ISO timestamps

### `GET /audit/export.csv`

Same filters, CSV output. One row per event, with `metadata` JSON
flattened into a string. Open in Excel / Sheets / `csvkit`.

### `GET /audit` UI

`/audit` is an admin page that lists events in a table. Filters at the
top (actor, target type, date range). Reuses `.admin-table` from the
admin page.

## Tests

- `cypress/e2e/api/05-audit.cy.js` — 10 tests: every mutation creates
  exactly one event, filters work, CSV export shape.

The most important contract: **every mutation produces one audit row**.
A passing test for that lives in `05-audit.cy.js`.
