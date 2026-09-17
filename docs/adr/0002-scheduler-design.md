# ADR-0002 — In-process cron scheduler with optimistic-claim concurrency

- Status: Accepted
- Date: 2026-09-17
- Supersedes: —
- Related: [`docs/scheduler.md`](../scheduler.md), [`utils/cron.js`](../../utils/cron.js), [`middleware/schedulerLoop.js`](../../middleware/schedulerLoop.js), [`routes/scheduledJobs.js`](../../routes/scheduledJobs.js)

## Context

A test manager that supports scheduled triggers — "run the smoke suite
every weekday at 09:00" — has to *actually fire* that job at the right
moment. CRUD endpoints (`POST /scheduled-jobs`, `PUT /scheduled-jobs/:id`)
give users a way to express intent; this ADR covers the runtime that
turns that intent into actual `TestRun` rows.

The four design axes are:

1. **Where does the loop run?** In the same Node process as the API,
   a separate worker process, or against an external queue (BullMQ,
   RabbitMQ, Cloud Scheduler)?
2. **How are due jobs discovered?** A `setInterval` that polls
   `next_run_at <= now`, or push from a cron daemon?
3. **How is concurrency bounded?** Optimistic-claim (UPDATE WHERE
   matches a value the worker just read), row-level lock
   (`SELECT … FOR UPDATE SKIP LOCKED`), or a queue worker pulling one
   job at a time?
4. **How is the cron expression parsed?** `cron-parser` from npm, a
   `cron` daemon call, or a hand-rolled 100-LOC parser?

## Decision

1. **In-process.** `middleware/schedulerLoop.js` lives in the same
   Node process as `index.js` and starts on `app.listen()`. Boot, config,
   observability, and shutdown all stay in one file. The cost: a process
   restart loses ticks; the mitigation is that the tick interval (60s
   default) is small enough that the worst-case miss is one cycle.

2. **Polling `setInterval`.** Every `SCHEDULER_TICK_MS` (default 60 000),
   the loop runs `tick()`:

   ```sql
   SELECT * FROM scheduled_jobs
    WHERE deleted_at IS NULL
      AND (next_run_at <= now() OR (retry_at <= now() AND retry_count > 0))
      AND enabled = true
   ```

   Push-style (a real cron daemon calling our HTTP API) was rejected —
   the operational footprint of running + monitoring a second system
   is bigger than the saved wall-clock.

3. **Optimistic-claim.** For each candidate, the worker reads the row,
   computes the work, and then issues:

   ```sql
   UPDATE scheduled_jobs
      SET last_run_at = now(),
          next_run_at = <computed next>,
          retry_count = 0,
          retry_at    = NULL
    WHERE id = <id>
      AND next_run_at = <the value the worker just read>
   ```

   If another tick (or an admin `PUT /scheduled-jobs/:id` re-schedule)
   changed `next_run_at` between the SELECT and the UPDATE, the
   `WHERE next_run_at = <expected>` no longer matches and the UPDATE
   affects zero rows. The first writer wins; the second writer's
   candidate is silently skipped. No advisory locks, no `SELECT FOR
   UPDATE`, no Redis claim key. The invariant — *"two ticks can never
   double-fire the same job"* — is enforced by Postgres, not by
   application memory.

4. **Hand-rolled parser in `utils/cron.js`.** The whole module is
   ~190 LOC including comments. We use only the standard 5-field
   Vixie-cron subset (`*`, `N`, `*/N`, `A-B`, `A,B`). No 3rd-party
   dep, no licence audit, no `cron-parser` upstream version-bumps.

5. **Retry.** Exponential backoff with jitter:
   `retry_at = now() + 2^retry_count minutes + rand(0..30)s`. Capped
   at `max_retries` (default 3); beyond that, the job stays errored
   until an admin re-enables it. Treating `max_retries=0` as
   "no retries, first failure is final" gives new users the
   conservative default they want.

## Consequences

Positive:

- **One process.** Single Dockerfile, single healthcheck, single set
  of logs. Adding a worker tier is a separate piece of complexity
  that the project's scale hasn't justified.
- **Latency-to-fire.** Worst-case 60 s after the scheduled minute,
  p50 is well under that. Test-suite runs measured ~150 ms from
  "tick fires" to "TestRun row created".
- **Postgres-as-source-of-truth.** A horizontal scale-out is one line
  of config away (`docker compose up --scale api=4`) — every replica's
  loop will see the same `next_run_at` and the optimistic-claim
  semantics guarantee at-most-one fires per scheduled minute.
- **Zero new deps.** The cron parser is plain JS, well-tested by
  `utils/cron.test.js` (29 unit cases covering range / step / list /
  dom-dow semantics).

Negative:

- **Tick loss on process restart.** A crash between T and T+30s means
  the scheduled job at T is missed, not delayed. We accept this because
  the alternative (durable timer queue) is operational weight the
  project hasn't earned yet.
- **No distributed rate limiting.** Two replicas can both see a job
  at the same instant; the optimistic-claim UPDATE serializes them,
  but the loser's tick still costs a DB round-trip. Acceptable at
  the project's scale.
- **`cron-parser`-class features are missing.** No `@reboot`, no
  `@yearly`, no L/W (last-week / last-day) syntax. None of the
  triggered suites in practice need them.

## Alternatives considered

- **`cron-parser` npm package.** Rejected: the small subset we
  actually use is ~30 LOC of regex, and the package would add a
  supply-chain surface for syntax we never test.
- **`node-cron`.** Same objection — heavyweight for our needs, and
  its in-process scheduling loop would be incompatible with our
  Postgres-backed state (the worker would lose jobs on restart).
- **BullMQ on Redis.** Right technology for a different scale.
  Adding Redis breaks the "clone-and-run" story; the perf gain
  over an in-process Postgres-backed loop is irrelevant for
  dozen-of-jobs workloads.
- **`SELECT … FOR UPDATE SKIP LOCKED`.** Locks held while the
  job runs (could be seconds for a real Cypress run). We use
  optimistic-claim instead precisely *because* jobs take seconds
  and a row-level lock for that long is a foot-gun.
- **Push from a system cron.** Either `crontab` calling our HTTP
  endpoint or a Cloud Scheduler webhook. Doubles the operational
  surface; one minute of polling is acceptable latency.

## Follow-ups

- When the project grows past ~50 active jobs, re-evaluate the
  60-second tick cadence — a 10-second tick with an exponential
  jitter on the SELECT (so multiple replicas don't all hit the
  DB at once) is a 5-LOC change.
- If a real-distributed deployment story emerges (read replicas
  in different regions, etc.), the optimistic-claim pattern
  still applies but will want a documented note in
  `docs/production-hardening.md` about which side of the
  replication lag the `next_run_at` row lives on.
- We have not implemented `@reboot` / `@yearly` semantics; an
  explicit "no" in the cron-parsing doc would save the next
  developer half an hour of investigation.
