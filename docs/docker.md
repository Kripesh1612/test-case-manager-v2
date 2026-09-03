# Docker

The whole stack — Postgres + the Node app — runs from one
`docker compose up`. No manual `migrate dev`, no `npm install`, no
Postgres setup. Bring it up, hit `http://localhost:3001`.

## What gets built

`Dockerfile` is a two-stage build on `node:22-alpine`:

| Stage  | What it does                                                  |
| ------ | ------------------------------------------------------------- |
| `deps` | `npm ci` (gets every dep, including the Prisma CLI). Prisma's postinstall hook generates the client at this point, so `node_modules/.prisma/client` already has the Alpine-musl binary baked in. |
| `runner` | Copies the prebuilt `node_modules` + source. Drops to a non-root user, exposes `3001`, and uses `scripts/docker-entrypoint.sh` as the entrypoint. |

`scripts/docker-entrypoint.sh` runs `prisma migrate deploy` (idempotent —
no-op if the DB is already at the latest migration) and then `exec`s the
CMD, so the Node process becomes PID 1 and receives container signals.

## What gets composed

`docker-compose.yml` defines two services:

- **postgres** — `postgres:16-alpine` with a named volume
  (`tcm-postgres-data`), a `pg_isready` healthcheck, and `5432` published
  to the host.
- **app** — built from the local `Dockerfile`. `depends_on: postgres:
  condition: service_healthy` so Docker waits for Postgres to be ready
  before starting the app. The app container's `DATABASE_URL` points at
  `postgres:5432` (the compose-internal DNS name), **not** `localhost`.

The app is published on `3001`.

## Common commands

```bash
npm run docker:up      # build + start (-d, detached)
npm run docker:logs    # tail the app logs
npm run docker:down    # stop (keeps the Postgres volume)
npm run docker:reset   # down -v (wipes the volume) + rebuild + up
```

Or directly with `docker compose`:

```bash
docker compose up --build
docker compose logs -f app
docker compose exec postgres psql -U tcm -d tcm   # open psql
```

## Configuration

Override any env var in your shell before running compose:

```bash
export JWT_SECRET="$(node -e 'console.log(require(\"crypto\").randomBytes(48).toString(\"hex\"))')"
export ADMIN_EMAILS="you@example.com"
npm run docker:up
```

Defaults (in `docker-compose.yml`) are safe for local dev:

| Var                  | Default                                |
| -------------------- | -------------------------------------- |
| `DATABASE_URL`       | `postgresql://tcm:tcm@postgres:5432/tcm?schema=public` |
| `PORT`               | `3001`                                 |
| `JWT_SECRET`         | `change-me-please-set-this-in-prod`    |
| `ADMIN_EMAILS`       | `cypress-admin@tcm.com,admin@tcm.com`  |
| `REGISTRATION_MODE`  | `open`                                 |
| `INVITE_TTL_DAYS`    | `7`                                    |
| `TRASH_RETENTION_DAYS` | `30`                                 |
| `AUDIT_ENABLED`      | `true`                                 |

## Data persistence

The Postgres data lives in the named Docker volume `tcm-postgres-data`,
**not** on a host bind mount. Consequences:

- `npm run docker:down` keeps the volume. Restart and your data is there.
- `npm run docker:reset` (or `docker compose down -v`) wipes it. Use this
  when test data gets unruly.
- To back up: `docker compose exec postgres pg_dump -U tcm tcm > backup.sql`
- To restore: `cat backup.sql | docker compose exec -T postgres psql -U tcm -d tcm`

## Running the Cypress tests against the containerised app

The Cypress suite runs against the host machine's `node index.js`, **not**
the container — Cypress needs a browser to talk to and launching Electron
inside a container is more friction than it's worth for a learning project.
So the typical dev loop is:

1. `npm run docker:up` → Postgres + app in containers
2. `npm run cy:run` → Cypress runs against the containerised app on
   `localhost:3001`

If you'd rather run Postgres in Docker and the app on the host (faster
restart on code changes), use `npm run db:up` instead and follow the bare
metal quick start.

## Why no `:latest` tag?

The `app` image is built from the local `Dockerfile`, so it's tagged
`tcm-app:latest` implicitly. There is no `:latest` from Docker Hub
because there is no upstream image to pull — the whole point is that
this repo builds it.
