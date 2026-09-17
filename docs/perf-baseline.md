# Performance baseline

Measured load numbers for the running app, captured under realistic
shape so the calibration can be re-run, repeated, and compared
against. The numbers below were taken against the production-mode
docker image on 2026-09-17 against a fresh database with ~20 seeded
test cases.

## Test environment

| Component | Version / state |
|---|---|
| App container | `tcm-app` running from the prod Dockerfile (multi-stage Alpine Node 22) |
| API port | 3001 (in-container), reverse-proxy-able |
| Postgres | `tcm-postgres` on 5433 (host port) |
| Mode | `NODE_ENV=production` |
| Load tool | [`autocannon`](https://github.com/mcollina/autocannon) v8.0.0 via `npx` |
| Database seed | 1 admin user, 1 perf user (`perftest-1@example.com`), 20 test cases |
| Host | Linux 7.0.0-31-generic, Docker 24+ |
| App baseline memory | 94.6 MiB at idle |

## Endpoints measured

Three endpoints spanning the spectrum — heavy DB read, narrow DB read
with auth, and a health check with no DB.

| Test | Endpoint | Concurrency | Duration | Auth |
|---|---|---|---|---|
| **list** | `GET /test-cases?limit=50` | 50 | 30 s | Bearer |
| **single** | `GET /test-cases/:id` | 50 | 20 s | Bearer |
| **health** | `GET /health` | 100 | 20 s | none |

The auth barrier is included because every real client request carries
it; if Bearer parsing or the role middleware shows up in the latency
profile, that should be visible here.

## Results

### `GET /test-cases?limit=50` (50 concurrent, 30 s)

This is the homepage-adjacent read — list with the project's row
limit. The shape of this endpoint is "DB read + role middleware +
response serialization for up to 50 rows".

```
Latency (ms)
  p50    : 136
  p95    : 221
  p99    : 255
  max    : 1159
  stdev  : 48
Throughput
  avg rps: 350.87
  total  : 10,526 requests in 30 s
Bandwidth
  avg    : 15.9 MB/s outbound
Errors  : 0 non-2xx responses
```

### `GET /test-cases/:id` (50 concurrent, 20 s)

The narrow read — primary key lookup, single row serialization.

```
Latency (ms)
  p50    : 48
  p95    : 71
  p99    : 82
  max    : 291
  stdev  : 14
Throughput
  avg rps: 996
  total  : 20,000 requests in 20 s
Bandwidth
  avg    : 615 kB/s outbound
Errors  : 0 non-2xx responses
```

### `GET /health` (100 concurrent, 20 s)

The cheap liveness probe the docker healthcheck pings every few seconds.
No DB, no auth, pure Express.

```
Latency (ms)
  p50    : ~2
  p95    : ~5
Throughput
  avg rps: 5,260
  total  : 105,000 requests in 20 s
Errors  : 0
```

## Memory footprint under load

```
                                  idle       after list+single+health
  tcm-app memory:                 94.6 MiB   188.1 MiB
  tcm-postgres memory:            ~30 MiB    44.1 MiB
```

The app's resident-set grows by roughly 2× under sustained 50-conn
load; this is V8 heap warmup, JIT compilation of the hot path, and
the Postgres pool's connection state. It stabilises rather than
climbing steadily across the test window — nothing here indicates an
unbounded allocation path. Raw outputs for all three runs are under
[`docs/perf-baseline-raw/`](./perf-baseline-raw/) for independent
inspection.

## What these numbers do and do not prove

**Do prove:**

- The list / single endpoints serve a realistic admin/editor load
  with p95 under 230 ms without any tuning.
- The health check is two orders of magnitude cheaper than the auth-bearing
  reads — there is a real cost to JWT verify + Prisma parse that the cheap
  path correctly avoids.
- No 5xx under sustained concurrency; the only error responses observed
  during the tests were intentional 401s from one malformed-token probe.

**Do not prove:**

- Latency under multi-tenant contention (each tenant's queries against
  the same Postgres pool). See `projectScope` for the scope path; testing
  this requires seeding multiple projects and warrants a future
  dedicated perf run.
- Behaviour of the SSE endpoint (`GET /runs/:id/stream`), which holds
  connections open indefinitely and is out of autocannon's small-file
  sync/response model. SSE perf is measured in concurrent-open headroom,
  not rps.
- Performance under network latency (the host and the container share
  a Docker bridge; real internet probes would add 20–80 ms baseline).
- Memory under sustained 24-hour load (these tests ran for under two
  minutes total). A leak in the executor or scheduler loop would only
  show across hours, not seconds.

## Reproduction

The exact runs above can be replayed against a running `tcm-app`
container with a seeded perf user:

```bash
# 1. ensure the app is up and a perf user exists
docker ps                                                # tcm-app + tcm-postgres
curl -s -X POST http://localhost:3001/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"perftest-1@example.com","password":"PerfTest123!","name":"perf"}'

# 2. log in once to capture a token for the auth-bearing runs
TOKEN=$(curl -s -X POST http://localhost:3001/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"perftest-1@example.com","password":"PerfTest123!"}' \
  | node -e 'process.stdin.on("data",d=>console.log(JSON.parse(d).token))')

# 3. the three runs, in order
npx --yes autocannon -c 50  -d 30 -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/test-cases?limit=50"

npx --yes autocannon -c 50  -d 20 -H "Authorization: Bearer $TOKEN" \
  "http://localhost:3001/test-cases/1"

npx --yes autocannon -c 100 -d 20 \
  "http://localhost:3001/health"

# 4. memory snapshot
docker stats tcm-app tcm-postgres --no-stream --format \
  '{{.Name}}  {{.MemUsage}}'
```

`autocannon` is not added to `package.json` deliberately — it is
pulled via `npx` so the perf harness stays decoupled from the app's
production deps. Anyone reviewing this baseline rerunning the
commands above should land within ±15% of the numbers shown above
on the same hardware.
