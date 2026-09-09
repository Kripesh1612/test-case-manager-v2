# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Audit log UI page at `/audit` (admin-only) with filter + pagination +
  before/after JSON diff. Surface lives at `client/src/features/audit/`.
- `requireOwnership` middleware (`middleware/requireOwnership.js`) so that
  editors can only modify test cases they themselves created. Admins bypass
  the check. Enforced on `PUT` and `DELETE /test-cases/:id`.
- `TestCase.created_by_id` column (nullable FK → users) recording the
  creator of each case. Backed by Prisma migration
  `20260907000000_add_test_case_ownership`.
- `utils/trashPurge.js` — runs on a 1h interval and hard-deletes any rows
  whose `deleted_at` is older than `TRASH_RETENTION_DAYS` (default 30).
  Opt out with `TRASH_PURGE_DISABLED=1`.
- IANA timezone support in cron-based scheduler jobs. `ScheduledJob.timezone`
  was previously stored but ignored; the loop now computes `next_run_at`
  in the job's local timezone using `Intl.DateTimeFormat`. UTC remains the
  default. Flags are stamped at parse time, not on every `nextFire` call.
- `middleware/registrationGate.test.js` — 10 `node:test` cases covering
  `open`, `invite`, and the `ADMIN_EMAILS` escape hatch.
- `utils/executor.test.js` — 8 `node:test` cases covering terminal-status
  mapping and the `finished` race guard.
- `app.set('trust proxy', TRUST_PROXY)` — configurable via env (default `1`)
  so X-Forwarded-For is honoured when running behind a reverse proxy.
- `express.json({ limit: JSON_BODY_LIMIT })` — body-size cap configurable
  via env (default `1mb`) to bound memory pressure from hostile clients.
- `.env.example` entries for `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_REGISTER_MAX`,
  `JSON_BODY_LIMIT`, `TRUST_PROXY`, `SCHEDULER_TICK_MS`, `SCHEDULER_DISABLED`.
- `npm run test:unit` script — 80 `node:test` cases (utils/cron,
  utils/flakiness, utils/diff, utils/executor, middleware/registrationGate)
  running in under a second, ideal for fast local feedback.
- `SECURITY.md` — supported-versions table and vulnerability disclosure
  policy.
- `docs/adr/0001-result-vs-run-state-model.md` — capture of the
  `TestCase.result` vs `TestRun.status` decision.
- Cypress API tests for editor-ownership enforcement (4 cases in
  `cypress/e2e/api/02-test-cases.cy.js`).
- Generated OpenAPI spec — `npm run openapi` writes `docs/openapi.json`
  from the shared Zod schemas (`scripts/generate-openapi.mjs`), covering
  49 operations across 38 paths with a Bearer security scheme.
- Swagger UI browser — `npm run openapi:serve` serves a Swagger UI on `:3002`
  that loads the local spec (see `docs/openapi.md`). UI assets are vendored
  from `swagger-ui-dist` at `/vendor/*`, so it renders with no internet access.
- `CONTRIBUTING.md` and `CODE_OF_CONDUCT.md`.

### Changed
- README test-count references reconciled again: 292 Cypress (133 API +
  144 UI + 15 advanced-patterns) + 80 `node:test` unit = 372 total. The
  static "N passing locally" badge was replaced with a **live GitHub
  Actions CI badge** so the count can't go stale again.
- `executor` finalizes a run with a `finished` guard so that the
  `child.on('error')` and `child.on('exit')` handlers cannot both call
  `finalize()` for the same run when the error event is emitted followed
  by exit (which Node does for spawn failures).
- On executor finalize, `TestCase.result` is now mirrored from the
  terminal `TestRun.status` (`passed`/`failed` only — `errored` does not
  overwrite a previously-passing case). Previously this only updated
  `last_run_at`, so the UI's "current result" indicator stayed stale until
  a manual cycle.
- Cron flag computation moved from `nextFire()` into `parseCron()` so the
  `domIsStar`/`dowIsStar` markers are stamped once at parse time, not
  re-derived on every tick.
- Dockerfile rewritten to use `cypress/included:13.17.0` (Debian glibc
  base) instead of the prior `node:22-alpine` build. Cypress's bundled
  Electron binary links against glibc and segfaults on musl, which made
  Phase 8 real-test execution fail at runtime. `HEALTHCHECK` `start-period`
  raised from 15s → 25s.
- README test-count references reconciled: 218 Cypress (129 API + 83 UI +
  6 shared) + 80 `node:test` unit = 298 total.
- `middleware/softDelete.js` removed — it was unused by every route
  (which already use Prisma `NOT_DELETED` scope helpers directly) and
  actively bypassed by several callers.

### Fixed
- `shared/schemas/flakiness.js` no longer mixes CommonJS `require()` with
  ESM `export` — the file now exports its schema as a plain CommonJS
  module to match how every other schema in the directory is consumed.
- Dead imports removed from `utils/executor.js` (`artifactPath`,
  `removeArtifacts`) and `routes/flakiness.js` (`withAudit`).
- `ScheduledJob.timezone` is now honoured (previously stored but ignored).

## [1.0.0] — 2026-09-01

Initial public release. Test case management with version history,
flakiness scoring, scheduler, and Phase 8 real Cypress execution.

[Unreleased]: https://github.com/Kripesh1612/test-case-manager-v2/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Kripesh1612/test-case-manager-v2/releases/tag/v1.0.0
