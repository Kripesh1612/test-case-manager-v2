# Docs

This folder explains *how this project teaches QA*. The full curriculum is
[`learning-path.md`](./learning-path.md) — start there. The list below is
an index of every other doc, grouped so any one of them is one click away.

## Curriculum

Read these first, in order:

1. [`learning-path.md`](./learning-path.md) — walks a newcomer from "I just
   cloned the repo" through every layer (curl → Postman → Cypress) in
   the order that builds understanding.
2. [`postman-vs-cypress.md`](./postman-vs-cypress.md) — when to reach for
   which tool, with concrete examples from this codebase.
3. [`cypress-patterns.md`](./cypress-patterns.md) — every Cypress pattern
   used in this suite, explained with a one-line "why".
4. [`rbac.md`](./rbac.md) — how the admin / editor / viewer model is
   enforced on both the server and the UI.
5. [`bugs-caught-by-tests.md`](./bugs-caught-by-tests.md) — real defects
   the suite caught while this project was being built. The commit
   history is itself a teaching resource.

## Subsystem deep-dives

One doc per cross-cutting mechanism, mapped 1:1 to a route or middleware
file in the codebase:

- [`architecture.md`](./architecture.md) — how the eight mechanisms
  compose (and what this project deliberately is *not*).
- [`audit-log.md`](./audit-log.md) — actor / action / target timeline;
  `middleware/withAudit.js`.
- [`soft-delete.md`](./soft-delete.md) — recoverable deletes via
  `deleted_at` tombstone; `middleware/softDelete.js`.
- [`case-versions.md`](./case-versions.md) — append-only version history,
  Myers diff, restore-as-version; `utils/snapshot.js` + `utils/diff.js`.
- [`test-runs.md`](./test-runs.md) — per-case runtime history;
  `routes/runs.js`.
- [`flakiness.md`](./flakiness.md) — 0-100 score + verdict per case;
  `utils/flakiness.js`.
- [`scheduler.md`](./scheduler.md) — in-process cron, optimistic-claim
  concurrency; `middleware/schedulerLoop.js` + `utils/cron.js`.
- [`test-execution.md`](./test-execution.md) — Phase 8: real Cypress run
  via SSE; `utils/executor.js` + `routes/execution.js`.
- [`invites.md`](./invites.md) — `REGISTRATION_MODE=invite` flow.

## Operations

- [`docker.md`](./docker.md) — `docker compose up` from cold start;
  healthchecks, multi-stage build, `wait-for-postgres`.
- [`ci.md`](./ci.md) — what the GitHub Actions workflow does, and the
  trade-offs it makes (test-count claim, video artifacts, etc.).

---

If you're new to QA, **don't try to read all of these at once**. The
learning-path doc is sequenced so you can read it end-to-end before
touching anything else.
