# Email digest (Feature 2)

A periodic "what happened?" summary for a project: new cases, updated cases,
and run outcomes since the last digest. Opt-in via `DIGEST_ENABLED=1`.

## How it works

1. `middleware/digestLoop.js` wakes on an interval (every 60s, not every
   digest period) and checks the `DIGEST_SCHEDULE` cron expression.
2. When the next fire time has passed AND no digest has been sent for that
   slot (tracked by the max `sent_at` in `digest_logs`), it calls
   `sendDigest`.
3. `utils/digest.js#composeDigest` counts activity since the previous digest
   (or the last 24h for the first one) and renders an HTML summary.
4. Delivery:
   - With `SMTP_HOST` configured → pushed over a minimal SMTP client.
   - Otherwise → a rendered `.eml` artifact is written to
     `storage/digests/project-<id>/digest-<log_id>.eml` so the loop is
     observable without a mail server.

Every digest writes a `digest_logs` row **first** — the row is the source of
truth, and the admin UI renders history from it whether or not email
delivery succeeds.

## Recipients

`DIGEST_RECIPIENTS` (comma-separated) wins; if unset the digest falls back
to `ADMIN_EMAILS`.

## Server pieces

| File                     | Responsibility                            |
| ------------------------ | ----------------------------------------- |
| `middleware/digestLoop.js` | cron-ish schedule loop (idempotent)      |
| `utils/digest.js`        | compose + persist + deliver (SMTP or .eml) |
| `routes/digest.js`       | admin-only history / send / preview       |

Routes are admin-only. `DigestLog` gained a `project_id` column so digests
are scoped per project (Feature 4 groundwork).

## Client UI

`/admin/digest` (`client/src/features/digest/`) — preview card (compose
without persisting), "Send now", and a history table of past digests.

## Configuration

| Env var              | Default        | Meaning                          |
| -------------------- | -------------- | -------------------------------- |
| `DIGEST_ENABLED`     | `false`        | Master switch (loop stays dormant) |
| `DIGEST_SCHEDULE`    | `0 8 * * *`    | Daily 08:00 UTC cron             |
| `DIGEST_RECIPIENTS`  | *(empty)*      | Comma-separated addresses         |
| `DIGEST_TICK_MS`     | `60000`        | Loop poll interval (tests tighten) |
| `SMTP_HOST`          | *(empty)*      | `host:port` → SMTP delivery instead of .eml artifact |

## Tests

- `utils/digest.test.js` — 8 `node:test` cases (fake prisma counts, HTML/MIME
  escaping, artifact fallback, loop gating + no-double-fire).
- `cypress/e2e/api/14-digest.cy.js` — RBAC, preview, send-persists,
  history ordering.
- `cypress/e2e/ui/13-digest.cy.js` — preview renders, send-now updates the
  history table.