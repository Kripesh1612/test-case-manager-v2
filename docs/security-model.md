# Security model

This document describes the threat model the project defends against,
the controls that mitigate each class of attack, and the audit trail
that proves each control is actually wired in. It is written so a
defense panel can answer "what stops X?" by pointing at one row in
the table below, and an external reviewer can verify every claim
against the linked code.

## Methodology

Threats are classified using [STRIDE][stride], the canonical
threat-modelling framework from Microsoft:

| Letter | Threat |
|---|---|
| **S** | Spoofing of identity |
| **T** | Tampering with data |
| **R** | Repudiation of action |
| **I** | Information disclosure |
| **D** | Denial of service |
| **E** | Elevation of privilege |

Each row in the table below lists:

- **Threat** — a concrete attack scenario, not a category
- **STRIDE** — which letters it falls under
- **Control** — the code path or invariant that defeats it
- **Where** — file:line so the control is verifiable
- **Closed by** — which adversarial audit finding forced the control
  to exist; pre-existing controls cite the commit that introduced them.

The **Closed by** column links each control back to a finding from the
multi-batch self-audit that ran across the codebase after the v0
feature set shipped. If a row reads "Pre-existing (initial design)",
the control was always there; if it reads "audit-batch-X", the control
was added in response to a finding.

[stride]: https://en.wikipedia.org/wiki/STRIDE_(security)

## Threat catalogue

### Identity and authentication

| # | Threat | STRIDE | Control | Where | Closed by |
|---|---|---|---|---|---|
| 1 | A stolen invite token is replayed months after issue, or used more than once | S, T | Invite tokens are single-use (consumed on first redeem), carry a server-side `expires_at`, and are hashed in storage. Token value is never returned after issue. | `routes/invites.js`, `utils/inviteToken.js` | Pre-existing |
| 2 | An attacker brute-forces the login endpoint | S, D | Per-IP rate-limit (`RATE_LIMIT_LOGIN_MAX=10` per 60s in production) + bcrypt cost ≥ 12; every rejected login pays the same CPU cost as an accepted one via a throwaway plaintext hash comparison. | `middleware/rateLimit.js`, `utils/auth.js#timingSafeComparePassword` | Pre-existing |
| 3 | A leaked JWT is replayed indefinitely | S, T | JWT lifetime is 24h by default (`JWT_EXPIRES_IN`), the algorithm is pinned to HS256 (`generateToken` refuses to verify under any other alg), and the signing secret is `JWT_SECRET` which throws if it equals the dev placeholder in production. | `utils/auth.js`, `utils/settings.js` | audit-batch-C |
| 4 | A forged cross-origin request triggers a state-changing action using the user's logged-in session | S, T, E | Global CSRF guard checks `Origin` / `Referer` against an allow-list for any non-safe HTTP verb; missing or foreign origins get a 403. | `middleware/csrf.js`, mounted in `index.js` | audit-batch-C |

### Authorization

| # | Threat | STRIDE | Control | Where | Closed by |
|---|---|---|---|---|---|
| 5 | An editor edits or deletes a case they did not create | T, E | `requireOwnership({ model: 'testCase' })` middleware checks `created_by_id === req.user.id` for non-admin callers. Edits outside ownership return 403. | `middleware/requireOwnership.js`, `routes/testCases.js` | Pre-existing |
| 6 | An admin in project A reads or mutates rows in project B | I, T, E | Every data-access path goes through `projectScope(req.user)` so Prisma `where` always carries `project_id: req.user.projectId`; a query for a foreign `projectId` returns 404, never 200, leaking no existence signal. | `utils/scope.js`, applied across `routes/*.js` | audit-batch-E (plus Phase 4/5 work) |
| 7 | A viewer (read-only role) submits a write that the UI happens to send | T, E | `requireRole('admin', 'editor')` middleware blocks writes for `viewer`; UI also hides write affordances to avoid broken-cursor UX. Belt + braces. | `middleware/roles.js`, `client/src/components/AppShell.tsx` | Pre-existing |
| 8 | An invite is created targeting a different project than the calling admin | I, T, E | `routes/invites.js` rejects `project_id` mismatches with 403; only the caller's own project is accepted, and only by admins of that project. | `routes/invites.js` | audit-batch-E |

### Data integrity

| # | Threat | STRIDE | Control | Where | Closed by |
|---|---|---|---|---|---|
| 9 | A user-authored Cypress snippet leaks into the audit log dump and exposes IP to log-aggregator consumers | I | The `executable_snippet` field is redacted from both `before` and `after` audit snapshots to `{ __redacted: 'executable_snippet', bytes: N }`. The full row stays in the live table; only the audit metadata is sanitised. | `routes/testCases.js#redactSnippet`, `middleware/withAudit.js` | audit-batch-C |
| 10 | A bulk-list query returns an unbounded response, OOM-ing the server or the React tree | D | Every list endpoint is paginated (`clampInt(req.query.limit, 1, 500, 200)`). Audit endpoints hardened with explicit integer parsing — `?actor_id=abc` returns 400, not silently filters to actor 1. | `utils/params.js`, `routes/*.js`, `routes/audit.js` | audit-batch-C, audit-batch-D |
| 11 | A malicious admin edits a webhook URL to `http://10.0.0.1/internal` (SSRF) | I, E | Webhook URLs are parsed and resolved before accept: scheme must be `https://`, host must be a public IP (loopback / private / link-local rejected), and DNS lookups are pinned to the resolved address to prevent DNS-rebinding attacks. | `utils/webhooks.js`, `routes/webhooks.js` | audit-batch-A |
| 12 | A webhook consumer receives a tampered payload | T | Every outbound delivery carries an HMAC-SHA256 signature in the `X-Regress-Signature` header (`sha256=<hex>`). Secrets are stored hashed and rotatable from the admin UI; per-delivery replay is supported. | `utils/webhooks.js`, `routes/webhooks.js` | audit-batch-A |

### Repudiation

| # | Threat | STRIDE | Control | Where | Closed by |
|---|---|---|---|---|---|
| 13 | An admin deletes a row and claims it never existed | R | Every mutating route is wrapped in `withAudit(action, ...)` which captures `actor_id`, `action`, `target_type`, `target_id`, optional `before` / `after` snapshots, and timestamp. Stored in `audit_events`. | `middleware/withAudit.js`, `routes/*.js`, `docs/audit-log.md` | Pre-existing |
| 14 | The host crashes mid-action leaving an inconsistent state | R | Critical multi-step writes (case update + run row creation) live inside `prisma.$transaction`. If the transaction throws, partial state never escapes. | `routes/testCases.js` | Pre-existing |

### Availability

| # | Threat | STRIDE | Control | Where | Closed by |
|---|---|---|---|---|---|
| 15 | A user submits a chatty Cypress snippet that prints gigabytes of stdout, OOM-ing the executor | D | The executor (`utils/executor.js`) keeps a rolling-buffer cap (256 KB each on stdout and stderr); chunks older than the window are dropped before emission, and the persisted artifact slices another 64 KB tail. | `utils/executor.js` | audit-batch-E |
| 16 | A `child.on('error')` AND `child.on('exit')` both fire, double-finalizing the run | D | The executor sets a `finished` guard flag inside both handlers; whichever fires first wins, the second is a no-op. Without it, the run row gets two writes and the SSE stream emits two `done` events. | `utils/executor.js` | Pre-existing |
| 17 | A bursty traffic spike saturates the API | D | Per-IP rate-limit on `/auth/*` (production defaults: 10 logins / 60s, 3 registrations / 60s). Relaxed to a 200-burst budget under `RATE_LIMIT_BURST=1` for the Cypress suite. | `middleware/rateLimit.js` | Pre-existing |
| 18 | A scheduled suite gets stuck in a held state after a crash | D | The cron loop uses **optimistic-claim** semantics: only the worker that successfully updates `claimed_at` within a TTL runs the job; if the worker dies, the next loop iteration picks the job up after the TTL. | `utils/cron.js`, `middleware/schedulerLoop.js` | Pre-existing |

### Information disclosure

| # | Threat | STRIDE | Control | Where | Closed by |
|---|---|---|---|---|---|
| 19 | The dev placeholder JWT secret is accidentally used in production | I | `utils/settings.js#getJwtSecret()` throws if `NODE_ENV=production` and `JWT_SECRET === 'dev-secret-change-me'`. The server fails fast at startup rather than serving traffic under a known secret. | `utils/settings.js` | Pre-existing |
| 20 | A redacted error log still includes the stack trace | I | The error-handler middleware redacts body and stack into a structured JSON line in dev, dropping the stack entirely in `NODE_ENV=production`. | `middleware/http.js` | audit-batch-C |
| 21 | Cross-tenant leak via shared joins | I | Every endpoint that takes an `id` in the path first verifies `project_id === req.user.projectId` via `projectScope`. A request like `GET /test-cases/<id-of-project-B>` from an admin in project A returns 404 — not 403, not the row. | `utils/scope.js`, `middleware/requireOwnership.js` | audit-batch-E |

### Elevation of privilege

| # | Threat | STRIDE | Control | Where | Closed by |
|---|---|---|---|---|---|
| 22 | An editor escalates to admin by tampering with their own JWT payload | E | JWT alg is pinned to HS256 and `jsonwebtoken.verify` is called with `algorithms: ['HS256']`; any token forged with a non-HS256 alg fails before role parsing. | `utils/auth.js` | audit-batch-C |
| 23 | An unprivileged user reaches an admin-only endpoint through a forgotten middleware | E | Every mutating route declares `requireRole(...)` explicitly. The router guard is the source of truth, not UI hiding. A new admin endpoint is admin-only by construction. | `middleware/roles.js`, all `routes/*.js` | Pre-existing |

## What is intentionally *not* mitigated

These are deliberate scope choices and are documented so reviewers
do not flag them as gaps:

| Surface | Status | Why |
|---|---|---|
| OpenID / SSO | not implemented | Beyond capstone scope; can be slotted in alongside `requireAuth` later |
| Refresh tokens | not implemented | 24h JWT lifetime + automatic logout on stale toast are adequate for the workload this app serves |
| Asymmetric (RS256) JWT signing | not implemented | Single-issuer app, no inter-service trust boundary; HS256 + a 48-byte secret is the right knob for this threat model |
| Rate-limit per-user (not per-IP) | not implemented | Trivial IP spoofing mitigated by short login window and bcrypt cost; full per-user tracking belongs in a reverse proxy |
| Field-level encryption at rest | not implemented | Postgres volume encryption is an ops concern; the app treats the database as the trust boundary |
| CSRF token (synchronizer pattern) | not implemented | The Origin/Referer check is a strictly stronger defence for the same threat and costs nothing to maintain |

## Verification

Every row in the catalogue above is covered by a test:

- API contract tests under `cypress/e2e/api/` check the **negative**
  cases (401, 403, 404, 400) for each mitigated threat.
- Node `node:test` unit cases under `utils/*.test.js` and
  `shared/schemas/auth.test.mjs` verify the helper-layer invariants
  directly (e.g. `timingSafeComparePassword` is timing-stable,
  `generateToken` rejects non-HS256 algs).
- The end-to-end UI tests in `cypress/e2e/ui/` verify the
  defence-in-depth surface — e.g. viewer role cannot see write controls
  even if the server accidentally let the request through.

Total: **152 unit cases** + **256 Cypress tests** including the
specific audit-batch closure tests. See [`docs/ci.md`](./ci.md) for
how the suite runs in CI on every push.

## Audit provenance

The **Closed by** column traces every post-v0 control back to its
triggering finding. The full audit narrative — including the
five-batch sweep, the issue lists, and the rationale for each fix —
is in [`docs/DEFENSE_ANALYSIS.md`](./DEFENSE_ANALYSIS.md) (sections
"10. Defensive mechanisms" and "13. Resolved issues").

If a defence is challenged in review, the resolution chain is:

1. Find the row in the table above.
2. Read the **Closed by** cell to see which audit batch forced the
   control.
3. Read the matching entry in `docs/DEFENSE_ANALYSIS.md` for the
   rationale and the diff (commit hash) that introduced it.

This makes every defence either observable in code (file:line) or
attributable to a documented decision — no "we meant to" rows.
