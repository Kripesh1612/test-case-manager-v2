# CI

`.github/workflows/ci.yml` runs the full Cypress suite on every push to
`main` and on every pull request. Total runtime is **3–4 minutes** on a
GitHub-hosted `ubuntu-latest` runner.

## What it does, step by step

1. **Checkout** the repo (`actions/checkout@v4`).
2. **Set up Node 22** with the npm cache primed from the previous run.
3. **Install deps** with `npm ci` — Prisma's postinstall hook runs
   `prisma generate`, producing the native client binary for the Ubuntu
   runner.
4. **Apply migrations** with `npx prisma migrate deploy` against a
   service-container Postgres.
5. **Run Cypress** via `cypress-io/github-action@v6`:
   - Boots `npm start` in the background.
   - Polls `http://localhost:3001/health` until the server is up.
   - Runs `cypress run` against the live app.
   - On failure, uploads screenshots + videos as workflow artifacts you
     can download from the run's summary page.

## Why this shape

- **Postgres as a service** — `services:` in the workflow spins up
  `postgres:16-alpine` with a `pg_isready` healthcheck. The app's
  `DATABASE_URL` points at `localhost:5432` because services share the
  runner's network namespace. No Docker-in-Docker needed.
- **`migrate deploy` instead of `migrate dev`** — `dev` is interactive
  and would fail; `deploy` is the CI-friendly variant (no shadow DB, no
  prompts, idempotent).
- **`cypress-io/github-action@v6`** — handles three pieces of boilerplate
  that would otherwise bloat the workflow: Cypress binary caching,
  starting the server, waiting for `/health`. The action's defaults use
  Electron (headless Chromium under the hood), which is already cached
  on the runner.
- **`CYPRESS_CRASH_REPORTS=0`** — disables the crash-reporting phone
  home on a CI runner where there's no UI to act on the prompt.

## Watching a run

Go to
[`Actions`](https://github.com/Kripesh1612/test-case-manager/actions) on
GitHub. Each run shows:

| Step                | Time     | Notes                                            |
| ------------------- | -------- | ------------------------------------------------ |
| Checkout            | ~5s      |                                                  |
| Setup Node          | ~10s     | Cache hit after first run                        |
| Install dependencies| ~30s     | Cache hit after first run                        |
| Apply Prisma migrations | ~5s | No-op after the first run (idempotent)           |
| Cypress run         | ~2–3 min | 145 tests, full API + UI + advanced patterns     |

If any test fails, the run goes red, the README badge flips to
`failing`, and you can download the failure screenshots from the
workflow's **Artifacts** section.

## Triggering runs locally

You can't reproduce the exact runner image locally, but you can
exercise the same logical sequence in three commands:

```bash
npm run docker:up                                # Postgres + app
docker compose exec -T postgres pg_isready -U tcm # confirm DB ready
npm run cy:run                                   # full suite
```

If that passes locally, it'll pass in CI.

## What's deliberately not in CI

- **Code coverage reports.** Adding `nyc` / `c8` would inflate the
  matrix for marginal value at this scale. If you want it later, add
  `--coverage` to the Cypress step and upload to Codecov.
- **Linting.** There's no `eslint` config in the project; running one
  now would force a refactor across every file.
- **Multiple Node versions.** Pinning 22 only matches `package.json`'s
  expected runtime. If/when you support older Node, add a matrix.
- **Cypress Dashboard recording.** Requires a paid Cypress account and a
  projectId; skipping it keeps CI fully free.
