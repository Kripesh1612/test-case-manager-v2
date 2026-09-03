> **Note:** This is a **v2 rewrite** of [test-case-manager](https://github.com/Kripesh1612/test-case-manager) *(now private)* — an old project I originally built myself. The git history in this repo starts fresh on 2026-09-03; the original commits live in the upstream repo linked above.

# Test Case Manager

[![CI](https://github.com/Kripesh1612/test-case-manager-v2/actions/workflows/ci.yml/badge.svg)](https://github.com/Kripesh1612/test-case-manager-v2/actions/workflows/ci.yml)

A small REST API + UI for managing test cases, **built as a learning
resource for QA**. Pick any layer — `curl`, Postman, or Cypress — and you
can drive the same app from it.

| Layer    | Where it lives                            | Best for                                  |
| -------- | ----------------------------------------- | ----------------------------------------- |
| `curl`   | the terminal                              | poking at a new API by hand               |
| Postman  | `postman/Test-Case-Manager.postman_collection.json` | sharing manual test plans with non-devs   |
| Cypress  | `cypress/e2e/`                            | regression coverage, RBAC, UI flows       |

If you're new to QA, **start with [`docs/learning-path.md`](./docs/learning-path.md)**.
It walks you through the layers in order.

## What it does

- **Auth** — register / login, JWT in `Authorization: Bearer …` header
- **Test cases** — CRUD with title, description, steps, expected result,
  status (draft/active/deprecated), priority (low/medium/high), run result
  (not_run/passed/failed), tags
- **Test suites** — group test cases, run all in one click
- **RBAC** — three roles (admin / editor / viewer), enforced on both
  server and UI
- **Test Runs** — every case has a history of runs, not just one result
- **Case versions** — every create/update snapshots the case into an
  append-only history; line-level Myers diff between any two revisions;
  one-click restore. See [`docs/case-versions.md`](./docs/case-versions.md).
- **Flakiness detector** — 0–100 score + categorical verdict per case
  (stable / possibly_flaky / flaky / very_flaky / broken), blended from
  recent-vs-baseline pass-rate disagreement, alternation rate, and a
  late-failure-after-streak signal. Badges in the list view, full report
  on the detail page, top-10 widget on the dashboard.
  See [`docs/flakiness.md`](./docs/flakiness.md).
- **Soft delete + Trash** — recoverable deletes instead of hard `DELETE`
- **Audit log** — every mutation is recorded with actor, action,
  before/after
- **Invites** — `REGISTRATION_MODE=invite` makes sign-up admin-controlled
- **Scheduler** — cron-based triggers that fire a test suite on a schedule
  (e.g. "run the smoke suite every weekday at 9am"). Built-in retry policy
  with exponential backoff + jitter; admin UI at `/scheduler`.
- **Real test execution (Phase 8)** — paste a Cypress snippet into a case,
  click Run, the server spawns the bundled Electron browser against your
  snippet and streams progress back over Server-Sent Events. The result
  is persisted as a regular `TestRun` so the flakiness detector gets
  real data to score instead of human-clicked pass/fail.
- **Stats** — pass rate, by-status / by-priority / by-result breakdown,
  recent runs

## Quick start — Docker (recommended)

```bash
# Brings up Postgres + the Node app together, applies migrations on
# startup, and prints the app logs. Open http://localhost:3001 when ready.
npm run docker:up

# First-time only — pull a real JWT_SECRET into your shell so the app
# stops using the placeholder. (Optional; the default works for local dev.)
export JWT_SECRET="$(node -e 'console.log(require(\"crypto\").randomBytes(48).toString(\"hex\"))')"
npm run docker:up

npm run docker:down    # stop
npm run docker:reset   # stop + wipe the Postgres volume + rebuild
npm run docker:logs    # tail the app logs
```

`docker compose up` runs `scripts/docker-entrypoint.sh`, which applies
pending Prisma migrations (`prisma migrate deploy`) and then execs
`node index.js`. No manual `migrate dev` step is required.

## Quick start — bare metal (Postgres on host)

```bash
npm install
cp .env.example .env                   # set DATABASE_URL + JWT_SECRET

# Option A — apt-installed Postgres:
sudo apt install postgresql
sudo -u postgres psql -c "CREATE USER tcm WITH PASSWORD 'tcm';"
sudo -u postgres psql -c "CREATE DATABASE tcm OWNER tcm;"
sudo systemctl start postgresql

# Option B — Docker Postgres only (app runs on host):
npm run db:up && npm run db:wait

# First-time only — apply migrations:
npx prisma migrate dev --name init

node index.js                          # http://localhost:3001
```

`npm run db:reset` brings the database back to a clean state (drops
the volume and recreates the schema). Use it when Cypress state gets
unruly.

The first account you create is just a normal `editor`. To bootstrap an
admin, set `ADMIN_EMAILS="you@example.com"` in your `.env` (see
`.env.example`) and re-register/login with that address — see
[`docs/rbac.md`](./docs/rbac.md) for how this works.

## Tests

```bash
npm run cy:open        # interactive
npm run cy:run         # headless, full suite (211 tests)
npm run cy:run:api     # 125 API-level tests only
npm run cy:run:ui      # 80 UI-level tests only
```

All 211 tests should be green. Walk through them in
[`docs/learning-path.md`](./docs/learning-path.md) for the recommended order.

## Docs

- [`docs/learning-path.md`](./docs/learning-path.md) — start here
- [`docs/docker.md`](./docs/docker.md) — `docker compose up` from cold start
- [`docs/ci.md`](./docs/ci.md) — what the GitHub Actions workflow does
- [`docs/architecture.md`](./docs/architecture.md) — how the six cross-cutting
  mechanisms compose (runs, soft delete, audit, invites, scheduler, executor)
- [`docs/test-runs.md`](./docs/test-runs.md) — runtime history per case
- [`docs/test-execution.md`](./docs/test-execution.md) — Phase 8: Cypress snippet → real run via SSE
- [`docs/flakiness.md`](./docs/flakiness.md) — score + verdict per case
- [`docs/soft-delete.md`](./docs/soft-delete.md) — recoverable deletes
- [`docs/audit-log.md`](./docs/audit-log.md) — actor / action / target timeline
- [`docs/invites.md`](./docs/invites.md) — invite-only sign-up
- [`docs/postman-vs-cypress.md`](./docs/postman-vs-cypress.md) — when to use each
- [`docs/cypress-patterns.md`](./docs/cypress-patterns.md) — every Cypress pattern used here
- [`docs/rbac.md`](./docs/rbac.md) — admin/editor/viewer model
- [`docs/bugs-caught-by-tests.md`](./docs/bugs-caught-by-tests.md) — real bugs the suite caught

## Project layout

```
postman/        — Postman collection + environment
cypress/
  e2e/
    api/        — 125 contract tests (no browser)
    ui/         — 80 end-to-end tests (real browser)
    06-advanced-patterns.cy.js  — cy.intercept() + cy.fixture() demos
  fixtures/     — sample JSON used by the advanced spec
  support/      — custom Cypress commands
public/         — vanilla-JS UI (HTML + JS + CSS, no framework)
routes/         — Express routers (auth, testCases, testSuites, users, …)
middleware/     — auth + RBAC + http helpers + scheduler loop
prisma/         — schema + Postgres migrations (data lives in Docker volume)
utils/          — small helpers (admin emails, serialization, cron parser, …)
docs/           — the learning resource this README links to
```

## Roadmap

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
- [x] Case version history + Myers diff (Phase 6) — see [docs/case-versions.md](docs/case-versions.md)
- [x] Flakiness detector (Phase 7) — 0–100 score + verdict per case from recent vs baseline pass-rate disagreement, alternation rate, and late-failure signal. Badges in the list view, full report on detail, top-10 widget on the dashboard. — see [docs/flakiness.md](docs/flakiness.md)
- [x] Real test execution (Phase 8) — paste a Cypress snippet per case, server-side spawn runs it and streams progress over SSE; results land as a normal `TestRun` and feed the flakiness detector.

## Notes

Data is persisted to a Postgres 16 instance — either via `npm run db:up`
(Docker container, named volume `tcm-postgres-data`) or against any
Postgres you point `DATABASE_URL` at. Reset with `npm run db:reset`.
