# Test Case Manager

> A self-contained test management platform: REST API, React UI, real Cypress
> execution, flakiness scoring, version history, scheduler, RBAC, audit log,
> and a 211-test end-to-end suite that documents itself.

[![CI](https://github.com/Kripesh1612/test-case-manager-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/Kripesh1612/test-case-manager-v2/actions/workflows/ci.yml)
[![Node](https://img.shields.io/badge/node-22-339933?logo=node.js&logoColor=white)](https://nodejs.org)
[![Postgres](https://img.shields.io/badge/postgres-16-336791?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![React](https://img.shields.io/badge/react-19-61DAFB?logo=react&logoColor=black)](https://react.dev)
[![Cypress](https://img.shields.io/badge/cypress-13-17202C?logo=cypress&logoColor=white)](https://www.cypress.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> **Note:** This is a **v2 rewrite** of [test-case-manager](https://github.com/Kripesh1612/test-case-manager) *(now private)*. The git history in this repo starts fresh on 2026-09-03; the original commits live in the upstream repo linked above.

---

## Table of contents

1. [Why this project exists](#why-this-project-exists)
2. [Features](#features)
3. [Tech stack](#tech-stack)
4. [Architecture at a glance](#architecture-at-a-glance)
5. [Quick start](#quick-start)
6. [Configuration](#configuration)
7. [Testing](#testing)
8. [API surface](#api-surface)
9. [Documentation](#documentation)
10. [Project layout](#project-layout)
11. [Roadmap](#roadmap)
12. [License](#license)

---

## Why this project exists

Most "test case manager" tutorials stop at a CRUD form. This one keeps going.
The goal is to ship a small, complete product — every layer of a modern
QA workflow — that still reads as a learning resource:

- The **same domain** (test cases, suites, runs) is exposed at three levels
  (curl, Postman, Cypress) so newcomers can pick the layer that matches their
  experience.
- Every **cross-cutting mechanism** (audit, soft delete, version history,
  flakiness, scheduler, real execution) lives in its own module and its own
  doc, so the codebase reads top-to-bottom.
- The **test suite doubles as documentation**: 125 API contract tests, 80 UI
  end-to-end tests, and a Postman collection that together cover every happy
  path and most of the unhappy ones.

If you are new to QA, start with [`docs/learning-path.md`](./docs/learning-path.md).
If you are reviewing this as a capstone submission, the [`docs/architecture.md`](./docs/architecture.md)
doc is the 5-minute tour.

---

## Features

### Core

| | |
|---|---|
| 🔐 **Auth + RBAC** | JWT in `Authorization: Bearer …`, three roles (`admin` / `editor` / `viewer`) enforced on both server and UI. The viewer role is read-only and the UI hides write controls. |
| 📝 **Test cases** | Title, description, ordered steps, expected result, status (`draft`/`active`/`deprecated`), priority (`low`/`medium`/`high`), tags, run result (`not_run`/`passed`/`failed`). |
| 📦 **Test suites** | Group cases, run all in one click, re-order membership. |
| 🕓 **Test runs** | Every case has an append-only history of runs — not a single mutable result. Drives the flakiness detector. |
| 🗑️ **Soft delete + Trash** | Recoverable deletes via a `deleted_at` tombstone. Restore from the `/trash` view before the retention window expires. |
| 📜 **Audit log** | Every mutation is recorded with actor, action, target, before/after snapshot. View timeline at `/admin` → *Audit*. |

### Differentiators

| | |
|---|---|
| 🧬 **Case version history** | Every create + update snapshots the case into an append-only history. Side-by-side **Myers diff** between any two revisions, with one-click restore. Badges + sidebar on the case detail page. |
| 📊 **Flakiness detector** | 0–100 score + categorical verdict (`stable` / `possibly_flaky` / `flaky` / `very_flaky` / `broken`) per case, blended from three signals: recent-vs-baseline pass-rate disagreement, alternation rate, and a late-failure-after-streak signal. Badges in the list view, full report on the detail page, top-10 widget on the dashboard. |
| ⏰ **Scheduler** | In-process cron loop fires suites on a schedule (e.g. *"run the smoke suite every weekday at 9am"*). Custom 100-LOC cron parser, optimistic-claim concurrency, retry policy with exponential backoff + jitter. Admin UI at `/scheduler`. |
| 🚀 **Real test execution (Phase 8)** | Paste a Cypress snippet into a case, click **Run**, the server spawns a real headless Electron browser against your snippet and streams progress back over **Server-Sent Events**. Result persists as a normal `TestRun` so the flakiness detector gets real data — not human-clicked pass/fail. |
| 🔁 **Regression split** | The dashboard's "Test reliability" widget separates **flaky tests** (alternation patterns that recover) from **recent regressions** (was passing, now consistently failing). Two different problems, two different sections. |
| 📨 **Invites** | `REGISTRATION_MODE=invite` makes sign-up admin-controlled. The first account is always bootstrap; admins issue invite tokens that gate subsequent registrations. |

### Quality

- **211 Cypress tests** (125 API + 80 UI + 6 advanced patterns) — all green in CI.
- **Zod schemas shared** between client and server (single source of truth for input validation).
- **Strict TypeScript** on the client (no `any` in the feature code).
- **Docker multi-stage build** with health checks and `wait-for-postgres`.
- **CI on every push** to `main` and every PR (~3–4 min, free for public repos).

---

## Tech stack

| Layer | Technology |
|---|---|
| Runtime | Node.js 22 (Express 5) |
| Database | PostgreSQL 16 via Prisma 5 |
| Auth | JWT (`jsonwebtoken`) + bcrypt |
| Validation | Zod (shared ESM schemas) |
| Frontend | React 19 + Vite 8 + TypeScript 5 + Tailwind 3 |
| Client data | TanStack Query v5 + React Hook Form + Zod resolver |
| Tests | Cypress 13 (Electron headless + E2E) |
| Container | Docker multi-stage, `docker compose` for local stack |
| CI | GitHub Actions (Ubuntu runner, 15-min timeout) |

No code generation, no ORMs beyond Prisma, no message broker, no Redis —
everything is in the single Node process and a single Postgres volume so
the project stays clone-and-run.

---

## Architecture at a glance

```
                        ┌────────────────────────────┐
                        │       React (Vite)         │
                        │  /login /cases /suites     │
                        │  /scheduler /admin /trash  │
                        │  /dashboard                │
                        └────────────┬───────────────┘
                                     │  /api/* (axios + Bearer)
                                     ▼
   ┌─────────────────────────────────────────────────────────────┐
   │                     Express 5 (Node 22)                     │
   │                                                             │
   │   ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
   │   │  routes/ │  │middleware│  │  utils/  │  │ shared/  │   │
   │   │  REST    │  │ auth/rbac│  │ flakiness│  │ Zod ESM  │   │
   │   │  routers │  │ audit    │  │ snapshot │  │ schemas  │   │
   │   │          │  │ softDel  │  │ diff     │  │          │   │
   │   │          │  │ rateLim  │  │ cron     │  │          │   │
   │   │          │  │          │  │ executor │  │          │   │
   │   └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘   │
   │        │             │              │             │        │
   │        └─────────────┴──────┬───────┴─────────────┘        │
   │                             │ Prisma 5                      │
   └─────────────────────────────┼───────────────────────────────┘
                                 ▼
                       ┌──────────────────────┐
                       │   PostgreSQL 16      │
                       │   (named volume)     │
                       └──────────────────────┘

   ┌────────────────────┐    ┌────────────────────┐
   │  Cypress (CI)      │    │  Cypress (local)   │
   │  211 tests         │    │  cy:open / cy:run  │
   └────────────────────┘    └────────────────────┘
```

The full breakdown is in [`docs/architecture.md`](./docs/architecture.md);
the eight cross-cutting mechanisms (runs, soft delete, audit, invites,
scheduler, executor, flakiness, version history) each get their own doc
too — see [Documentation](#documentation).

---

## Quick start

### Option A — Docker (recommended, zero local setup)

Requires Docker 24+ and Docker Compose v2.

```bash
git clone https://github.com/Kripesh1612/test-case-manager-v2
cd test-case-manager

# First-time only — pull a real JWT_SECRET into your shell so the app
# stops using the placeholder. (Optional; the default works for local dev.)
export JWT_SECRET="$(node -e 'console.log(require(\"crypto\").randomBytes(48).toString(\"hex\"))')"

npm run docker:up      # bring up Postgres + app, apply migrations, ready in ~10s
open http://localhost:3001

npm run docker:logs    # tail the app logs
npm run docker:down    # stop (keeps the Postgres volume)
npm run docker:reset   # stop + wipe the Postgres volume + rebuild
```

`docker compose up` runs `scripts/docker-entrypoint.sh`, which waits for
Postgres to pass its healthcheck, applies pending Prisma migrations
(`prisma migrate deploy`), then execs `node index.js`. No manual
`migrate dev` step required.

### Option B — bare metal (Node on host, Postgres in Docker)

```bash
git clone https://github.com/Kripesh1612/test-case-manager-v2
cd test-case-manager
npm install
cp .env.example .env                   # set DATABASE_URL + JWT_SECRET

npm run db:up && npm run db:wait       # Postgres on host port 5433
npx prisma migrate dev --name init

node index.js                          # http://localhost:3001
```

### Option C — fully on host (apt-installed Postgres)

```bash
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER tcm WITH PASSWORD 'tcm';"
sudo -u postgres psql -c "CREATE DATABASE tcm OWNER tcm;"
sudo systemctl start postgresql

npm install
cp .env.example .env                   # set DATABASE_URL
npx prisma migrate dev --name init
node index.js                          # http://localhost:3001
```

### First account

The first account you create is a normal `editor`. To bootstrap an admin,
set `ADMIN_EMAILS="you@example.com"` in `.env` (see [`.env.example`](./.env.example))
and re-register with that address — see [`docs/rbac.md`](./docs/rbac.md) for how
this works.

---

## Configuration

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3001` | HTTP port for the API + UI. |
| `DATABASE_URL` | `postgresql://tcm:tcm@localhost:5433/tcm?schema=public` | Postgres connection string. |
| `JWT_SECRET` | `dev-secret-change-me` | **Override in production.** The first account you create in dev uses the default; rotate it before exposing the app. |
| `ADMIN_EMAILS` | _(empty)_ | Comma-separated list. Any account registered with one of these emails gets the `admin` role. |
| `REGISTRATION_MODE` | `open` | `open` allows anyone to register; `invite` requires a valid invite token (admin-issued). |
| `INVITE_TTL_DAYS` | `7` | Invite-token validity in days. |
| `TRASH_RETENTION_DAYS` | `30` | Days before soft-deleted items are auto-purged. `0` disables purging. |
| `RATE_LIMIT_LOGIN_MAX` | `200` | Login attempts per IP per 60s. Tighten for production. |
| `RATE_LIMIT_REGISTER_MAX` | `200` | Register attempts per IP per 60s. Tighten for production. |
| `AUDIT_ENABLED` | `true` | Toggle the audit log off in high-throughput test environments. |

See [`utils/settings.js`](./utils/settings.js) for the canonical list and defaults.

---

## Testing

```bash
npm run cy:open        # interactive Cypress runner
npm run cy:run         # headless, full suite (211 tests, ~3 min)
npm run cy:run:api     # 125 API-level contract tests only
npm run cy:run:ui      # 80 UI-level end-to-end tests only
```

All 211 tests should be green. If you want to understand them, walk through
[`docs/learning-path.md`](./docs/learning-path.md) for the recommended order,
or read [`docs/cypress-patterns.md`](./docs/cypress-patterns.md) for a
catalog of every pattern used.

The suite is split so you can run a slice locally without paying for the
whole 3 minutes — useful when iterating on a single feature.

---

## API surface

Quick reference for the most-used endpoints. Full coverage is in
[`docs/architecture.md`](./docs/architecture.md) and the API spec files
under `cypress/e2e/api/`.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/auth/register` | Create an account. Rate-limited per IP. |
| `POST` | `/auth/login` | Issue a JWT. Rate-limited per IP. |
| `GET`  | `/auth/me` | Current user (requires `Authorization`). |
| `GET`  | `/test-cases` | List all non-deleted cases. |
| `POST` | `/test-cases` | Create a case (admin/editor). |
| `GET`  | `/test-cases/:id` | Fetch one case. |
| `PUT`  | `/test-cases/:id` | Update a case (admin/editor). Snapshots a new version. |
| `DELETE` | `/test-cases/:id` | Soft-delete (admin/editor). |
| `GET`  | `/test-cases/:id/versions` | List version history. |
| `GET`  | `/test-cases/:id/versions/:v1/diff/:v2` | Field-by-field Myers diff. |
| `POST` | `/test-cases/:id/versions/:vid/restore` | Restore from a version (admin/editor). |
| `GET`  | `/test-cases/:id/flakiness` | Score + verdict + signals. |
| `GET`  | `/test-cases/flaky?threshold=50` | Top-N flaky cases (dashboard widget). |
| `POST` | `/test-cases/:id/execute` | Phase 8: start a real Cypress run. |
| `GET`  | `/runs/:id/stream` | SSE feed for an in-flight run. |
| `GET`  | `/test-suites` / `/test-suites/:id` | Suite CRUD. |
| `GET`  | `/scheduled-jobs` / `POST` / `PUT` / `DELETE` | Cron jobs. |
| `GET`  | `/trash/cases` / `/trash/suites` | Soft-deleted items. |
| `POST` | `/trash/:type/:id/restore` | Recover. |
| `GET`  | `/audit` | Audit log timeline (admin). |
| `POST` | `/invites` | Issue an invite token (admin). |

All endpoints (except `/auth/*`, `/invite-redeem`, `/health`) require
`Authorization: Bearer <token>`. RBAC is enforced at the router level via
`requireRole('admin', 'editor')`.

---

## Documentation

The docs folder is the *second* deliverable of this project. The full
curriculum is in [`docs/learning-path.md`](./docs/learning-path.md).

### Curriculum (read in order)

- [`docs/learning-path.md`](./docs/learning-path.md) — the recommended walkthrough
- [`docs/postman-vs-cypress.md`](./docs/postman-vs-cypress.md) — when to reach for which tool
- [`docs/cypress-patterns.md`](./docs/cypress-patterns.md) — every Cypress pattern in the suite
- [`docs/rbac.md`](./docs/rbac.md) — how the three-role model is enforced
- [`docs/bugs-caught-by-tests.md`](./docs/bugs-caught-by-tests.md) — real defects the suite caught

### Subsystem deep-dives (one doc per mechanism)

- [`docs/architecture.md`](./docs/architecture.md) — how the eight mechanisms compose
- [`docs/audit-log.md`](./docs/audit-log.md) — `middleware/withAudit.js`
- [`docs/soft-delete.md`](./docs/soft-delete.md) — `middleware/softDelete.js` + `deleted_at`
- [`docs/case-versions.md`](./docs/case-versions.md) — `utils/snapshot.js` + `utils/diff.js`
- [`docs/test-runs.md`](./docs/test-runs.md) — `routes/runs.js`
- [`docs/flakiness.md`](./docs/flakiness.md) — `utils/flakiness.js`
- [`docs/scheduler.md`](./docs/scheduler.md) — `middleware/schedulerLoop.js` + `utils/cron.js`
- [`docs/test-execution.md`](./docs/test-execution.md) — `utils/executor.js` + `routes/execution.js`
- [`docs/invites.md`](./docs/invites.md) — `REGISTRATION_MODE=invite` flow

### Operations

- [`docs/docker.md`](./docs/docker.md) — `docker compose up` from cold start
- [`docs/ci.md`](./docs/ci.md) — what the GitHub Actions workflow does

---

## Project layout

```
.
├── client/                       React + Vite + TypeScript SPA (primary UI)
│   ├── src/
│   │   ├── features/             One folder per domain (cases, suites, runs, ...)
│   │   ├── components/           Shared UI primitives (Modal, ToastHost, ProtectedRoute)
│   │   ├── hooks/                Cross-feature React hooks (useAuth, ...)
│   │   ├── lib/                  Cross-cutting helpers (http, toast, extractError)
│   │   └── App.tsx               Router + Shell + auth-aware navigation
│   └── dist/                     Production build (emitted by `npm run build -w client`)
├── public/                       Legacy vanilla-JS pages — only invite-redeem.html is live
├── routes/                       Express routers (auth, testCases, testSuites, runs, ...)
├── middleware/                   auth + RBAC + http helpers + audit + scheduler loop
├── utils/                        Small helpers (snapshot, diff, flakiness, cron, executor, ...)
├── shared/schemas/               Zod schemas shared between client and server
├── prisma/                       Schema + Postgres migrations
├── cypress/
│   ├── e2e/api/                  125 contract tests (no browser)
│   ├── e2e/ui/                   80 end-to-end tests (real browser)
│   ├── fixtures/                 Sample JSON
│   └── support/                  Custom commands (loginAsAdmin, createTestCase, ...)
├── postman/                      Postman collection + environment
├── docs/                         The learning resource this README links to
├── scripts/                      docker-entrypoint.sh, wait-for-postgres.js
├── .github/workflows/ci.yml      GitHub Actions CI
├── Dockerfile                    Multi-stage build
├── docker-compose.yml            Local stack
├── index.js                      App entry — mounts routers, static, error handlers
└── package.json                  Scripts: dev, test, cy:*, docker:*, db:*
```

---

## Roadmap

Completed across the eight phases of development:

- [x] Project setup + Express hello world
- [x] CRUD endpoints (in-memory → SQLite + Prisma → Postgres)
- [x] Test Suite grouping
- [x] JWT authentication
- [x] Validation + error handling
- [x] Postman collection (with pre-request scripts)
- [x] Vanilla-JS UI in `public/`
- [x] RBAC (admin / editor / viewer) — enforced on server *and* UI
- [x] Cypress — 211 tests across API + UI
- [x] Advanced Cypress patterns — `cy.intercept()` + `cy.fixture()`
- [x] Docs that read like a curriculum
- [x] Docker + env config
- [x] CI (GitHub Actions) — runs `npm run test` on every push
- [x] React + Vite + TypeScript + Tailwind migration (Phase 5)
- [x] Case version history + Myers diff (Phase 6) — [`docs/case-versions.md`](./docs/case-versions.md)
- [x] Flakiness detector + regression split (Phase 7) — [`docs/flakiness.md`](./docs/flakiness.md)
- [x] Real test execution via SSE (Phase 8) — [`docs/test-execution.md`](./docs/test-execution.md)

Next steps (intentionally left for future work):

- [ ] Webhook notifications on suite run completion
- [ ] Per-project isolation (multi-tenant)
- [ ] Email digest for flakiness regressions
- [ ] Visual regression diffs for screenshot-bearing cases

---

## Contributing

Issues and PRs are welcome. The bar for new code:

1. **Add a test first** — API tests for new endpoints, UI tests for new
   flows. The suite is the documentation.
2. **Share the Zod schema** — input validation lives in `shared/schemas/`
   and is consumed by both client (form validation) and server (request
   validation). One source of truth.
3. **Add a doc** — if you add a cross-cutting mechanism, add a doc in
   `docs/` and link it from this README.
4. **Match the code style** — the client is strict TypeScript with Tailwind
   utility classes; the server is CommonJS Express with inline JSDoc on
   every exported helper.

---

## License

[MIT](./LICENSE) © 2026 Kripesh. See [`LICENSE`](./LICENSE) for the full text.

---

<sub>Built as a learning resource for QA. If this project helped you,
star the repo — it helps others find it.</sub>
