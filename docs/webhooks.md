# Webhooks (Feature 1)

Webhooks notify external systems when a test suite finishes running. On every
`suite.run.completed` event, Regress POSTs a signed JSON payload to each
enabled subscription for the project.

## What events are emitted

| Event                 | Fires when                                  | Source call site                              |
| --------------------- | ------------------------------------------- | --------------------------------------------- |
| `suite.run.completed` | A suite run finishes (manual or scheduler)  | `routes/testSuites.js`, `middleware/schedulerLoop.js` |

The emitter is **fire-and-forget**: `emitSuiteRunCompleted(...)` is awaited
with `.catch()` swallowing failures, so a slow/unreachable endpoint can never
delay the suite-run response.

## The payload

```json
{
  "event": "suite.run.completed",
  "suite_id": 42,
  "project_id": 1,
  "outcome": { "status": "passed", "updated": 3, "run_by": 7, "trigger": "manual" },
  "delivered_at": "2026-09-10T08:00:00.000Z"
}
```

## Signature

Each delivery carries an `X-Regress-Signature` header:

```
X-Regress-Signature: sha256=<hex HMAC-SHA256 of the raw request body>
```

Computed with the webhook's shared `secret` (empty secret → no header).
Consumers verify the signature to prove the payload really came from Regress.

## Delivery semantics

- HTTP(S) POST with `Content-Type: application/json`.
- Retries: up to `WEBHOOK_RETRIES` (default `2`) with an in-memory backoff.
- Timeout: `WEBHOOK_TIMEOUT_MS` (default `5000`).
- Every attempt writes a `webhook_deliveries` row (the audit trail), even on
  network failure — the admin UI shows these as "attempted" deliveries.

## Server pieces

| File                           | Responsibility                                |
| ------------------------------ | --------------------------------------------- |
| `utils/webhooks.js`            | signature, HTTP push, retry, event emission   |
| `routes/webhooks.js`           | admin-only CRUD + `POST /:id/test` + history  |
| `shared/schemas/webhook.js`    | zod validation (URL shape, event enum, etc.)  |
| `middleware/schedulerLoop.js`  | emits the event from scheduled suite runs     |

Routes are admin-only (`requireRole('admin')`) and project-scoped:
`projectScope(req.user)` filters every query, so one project can never read
or mutate another project's webhooks.

## Client UI

`/admin/webhooks` (`client/src/features/webhooks/`) — list, create/edit modal,
enable/disable toggle, test ping, and a 50-row delivery-history drawer.

## Configuration

| Env var               | Default | Meaning                          |
| --------------------- | ------- | -------------------------------- |
| `WEBHOOKS_ENABLED`    | `true`  | Master switch for emission       |
| `WEBHOOK_RETRIES`     | `2`     | Delivery attempts per event      |
| `WEBHOOK_TIMEOUT_MS`  | `5000`  | Per-attempt timeout             |

## Tests

- `utils/webhooks.test.js` — 8 unit tests (signature, HTTP status handling,
  retry give-up, HMAC header) using a real ephemeral `http.Server`.
- `cypress/e2e/api/13-webhooks.cy.js` — 7 end-to-end tests (RBAC, CRUD,
  validation, test ping, real suite-run emission, project scoping).

## Notes on emission timing

Because the emitter is asynchronous, tests **poll**: the suite-run request
asserts on the response, then retries
`GET /webhooks/:id/deliveries` (see `waitForDelivery` in the Cypress spec)
until the delivery row appears.