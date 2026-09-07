# Production Hardening

> This doc is the audit trail for the **security and operational posture**
> of Regress as deployed. It backs every claim with a concrete default,
> env var, or line of code, and tells the operator exactly what to flip
> before exposing the app outside `localhost`.

---

## Posture statement

Regress is a **single-process Node app** behind whatever reverse proxy
the operator chooses. It ships with **defaults that favor a friendly
local-dev + Cypress-E2E workflow** over a hostile-internet posture, and
**every default is overridden by an env var** listed below. The expected
deployment shape is:

```
[ client ]
   │  (HTTPS terminated upstream — e.g. nginx, Caddy, a CDN)
   ▼
[ this app (Express, behind a trusted proxy) ]
   │  (bearer-token auth, no sessions)
   ▼
[ Postgres 16 ]
```

The threat model the defaults target is *untrusted user, hostile request
body, benign network*. They do **not** target *untrusted network,
multi-tenant workloads, or compliance regimes* (SOC 2, HIPAA, etc.) —
those require the changes at the bottom of this page.

---

## What is already hardened

### Authentication

- **Bearer-JWT auth** (HS256, 7-day expiry) — `utils/auth.js`. Tokens
  are sent as `Authorization: Bearer …` and never touch a cookie, so
  CSRF is **structurally impossible** without a session cookie; an
  attacker can't force the browser to send a token it doesn't already
  hold.
- **bcrypt password hashing** with 10 salt rounds — `utils/auth.js:5`.
  10 is the OWASP-recommended minimum for 2025-era hardware.
- **Zod schema validation** on every request body at the route level
  (`middleware/http.js`, schemas in `shared/schemas/`). Reject-then-handle
  on every endpoint.

### Authorization (RBAC)

- **Three-role RBAC** (admin / editor / viewer) — `middleware/roles.js`.
  Role check is a separate `requireRole(...)` middleware applied per
  route, never a global policy table. Editors and viewers cannot mutate;
  viewer-only UI hides write controls via `hidden={!writable}` patterns.
- **Audit log** records every successful mutation with `actor`, `action`,
  `target_type`, `target_id`, `before`/`after` snapshot, IP, user-agent —
  `middleware/withAudit.js`. 4xx/5xx are deliberately not audited
  (the request didn't mutate). Audit-write failures are logged and
  swallowed — they never crash the request.

### Real test execution (Phase 8)

- **Cypress child process is spawned with arg arrays, not a shell string.**
  `utils/executor.js:88` — `spawn(CYPRESS_BIN, args, { cwd, env })`. Every
  flag (`--spec`, `--project`, `--browser`, `--reporter`,
  `--reporter-options`, `--config`) is a separate argv element, so a
  malicious test snippet cannot escape into argv.
- **The user's snippet is written to a file and referenced by path**
  (`utils/executor.js:68`). Cypress reads the file content; the parent
  process never interpolates it.
- **Logs are capped at 64 KB** per run (`utils/executor.js:130`) so a
  runaway Cypress can't fill the disk.

### Scheduler

- **Optimistic-claim concurrency** (`middleware/schedulerLoop.js`).
  Multiple ticks, a manual PATCH, or a retry race cannot double-fire a
  job — the DB is the lock, not in-process state.
- **Retry policy is bounded** (60-min cap, 0–30 s jitter, no
  resurrection after `max_retries`).

---

## Knobs to flip before exposing this app to the internet

All of these are env-tunable. Defaults are listed because every value
is read inside a getter function (see `utils/settings.js`), so changing
`process.env.X` and re-reading works at runtime without a code deploy.

| Env var | Default | Set to … | Why it matters |
|---|---|---|---|
| `JWT_SECRET` | `dev-secret-change-me` | a long random string (≥ 48 bytes) | The default is in the repo. Tokens signed with it are forgeable by anyone who reads the repo. Generate with `node -e 'console.log(require("crypto").randomBytes(48).toString("hex"))'`. |
| `ADMIN_EMAILS` | *(empty)* | your real email | The empty default means the *first* registered user (regardless of who they are) becomes admin. Set this to your own email so the admin slot is reserved before public sign-up. |
| `REGISTRATION_MODE` | `open` | `invite` | `open` lets anyone POST `/auth/register`. Switch to `invite` so first user becomes bootstrap admin and subsequent registrations require a token from `/invites` (admin-only). |
| `RATE_LIMIT_LOGIN_MAX` | `200` | `5–10` | 200 req/min/IP is tuned so the Cypress API suite doesn't trip the limiter. Real human attackers should not exceed ~10. |
| `RATE_LIMIT_REGISTER_MAX` | `200` | `3–5` | Same rationale. Tighter on register because there is no legitimate reason to retry. |
| `INVITE_TTL_DAYS` | `7` | `1–3` | 7 days is fine for a team of 5; tighter for larger audiences. |
| `TRASH_RETENTION_DAYS` | `30` | `30–90` | Soft-deleted rows are auto-purged after this many days. Set to `0` to keep them forever (and prune manually via `/admin`). |
| `AUDIT_ENABLED` | `true` | `true` | Set to `false` only for benchmark / perf testing. In production you want every mutation captured. |

---

## Known limitations (not bugs — out of scope for a capstone)

1. **Single-tenant.** User roles are global, not per-workspace.
   Multi-tenant work would require a `tenant_id` on every row and a
   scoping helper analogous to `utils/scope.js#NOT_DELETED`.
2. **In-process rate limiter.** `utils/rateLimit.js` keeps buckets in a
   `Map`. That is fine for **one Node process** (which is the only mode
   the scheduler loop also runs in). A multi-process deployment would
   need a shared store (Redis, Postgres advisory locks) so login
   attempts across instances aggregate. Not currently a concern because
   the production posture is one container.
3. **No HTTPS enforcement at the app level.** We assume the operator
   terminates TLS upstream (a CDN, nginx, or a load balancer). The app
   sets `app.set('trust proxy', 1)` once a proxy is configured — without
   that, `req.ip` falls back to the socket address and the rate limiter
   sees every request from the same IP.
4. **Audit is admin-tamperable.** Any user with `role='admin'` can
   issue raw UPDATEs to `audit_events`. There is no DB-level
   append-only enforcement. Production deployments that need tamper
   evidence should add a Postgres `REVOKE UPDATE, DELETE ON audit_events
   FROM PUBLIC`, or move the table to a separate read-only role/replica.
5. **JWTs are long-lived (7 days, no refresh tokens, no revocation list).**
   There is no `/auth/logout` endpoint that invalidates a token server-side;
   the only way to "log out" is to drop the token from the client.
   A leaked token is valid until its `exp`. For higher-trust environments,
   shorten the expiry to 15–60 minutes and add a refresh-token flow +
   denylist.
6. **No CSRF protection — intentional.** Bearer tokens are immune to
   CSRF, so there's nothing to defend against with a cookie/session
   setup. Documented here so a future maintainer doesn't add a stateful
   session layer on top without re-auditing this assumption.
7. **No password complexity / breach-list check.** Registration accepts
   any password of any length. We rely on bcrypt's work factor to
   absorb weak passwords. A real deployment would add a zxcvbn-style
   strength check or HIBP's k-anonymity API on `/auth/register`.
8. **Executor runs at full trust.** Any authed user can run an
   `executable_snippet` and the parent process spawns Cypress. A
   compromised account can tie up the runner. A future change should
   rate-limit executions per-user and isolate each run in a
   per-runner-process pool.

---

## Forward-looking changes (next quarter of work)

These are the natural next steps if this project graduates from capstone
to production. Each is a focused piece of work — not all-or-nothing.

- **OAuth 2.0 / OIDC** alongside the email-password path. Useful for
  enterprise SSO without taking the password path away.
- **Per-tenant rate limits.** Replace the in-process `Map` with a
  Redis-backed limiter that keys on `(tenant_id, ip)`.
- **Token revocation list.** Short-lived JWTs (15 min) + refresh tokens
  stored server-side; logout invalidates the refresh row.
- **Postgres `REVOKE UPDATE, DELETE` on `audit_events`.** One-line
  migration, enforced at the DB level, blocks even admin UPDATEs.
- **`executor.js` per-run sandbox.** Run Cypress in a temp
  `chroot`/`bwrap` directory, kill after a wall-clock timeout, never
  share state between runs.
- **Image hardening.** The Docker image already runs as a non-root user
  (`tcm`); add `read_only: true`, `cap_drop: ALL`, and a 100 MB tmpfs
  for the Cypress tmp dir.
- **OpenAPI spec + auto-generated client.** The Zod schemas in
  `shared/schemas/` are already used by both ends; wiring
  `@asteasolutions/zod-to-openapi` would publish a spec panel members
  can browse.

---

## How to verify this doc stays accurate

Each claim in the *What is already hardened* and *Known limitations*
sections references a concrete source file and line. Run those greps
against `main` and diff against this doc on every PR:

```bash
# Auth / RBAC / audit
grep -nE "bcrypt|hashPassword|SALT_ROUNDS|requireRole|withAudit" utils/auth.js middleware/

# Executor safety
grep -nE "spawn\(|--spec|--config" utils/executor.js

# Rate limit defaults
grep -nE "DEFAULT_RATE_LIMIT|makeRateLimiter" utils/settings.js utils/rateLimit.js routes/auth.js

# JWT secret default
grep -nE "DEFAULT_JWT_SECRET|getJwtSecret" utils/settings.js
```

If any of these stop matching what's here, this doc is the change to
make in the same PR.
