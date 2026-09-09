# Contributing to Regress

Thanks for considering a contribution. This project doubles as a learning
resource, so the bar for new code is documented and the test suite is the
spec. Before opening a PR, please make sure your change fits the conventions
below — they keep the codebase readable top-to-bottom and the suite green.

## Setup

```bash
npm install
npm run docker:up        # Postgres + app, ready in ~10s
```

Or the bare-metal path — see the [README](./README.md#quick-start).

## The four rules

1. **Add a test first.** API tests for new endpoints (`cypress/e2e/api/`),
   UI tests for new flows (`cypress/e2e/ui/`). The suite is the
   documentation. If you're adding a cross-cutting mechanism, unit-test the
   algorithm too (`utils/*.test.js` with `npm run test:unit`).

2. **Share the Zod schema.** Input validation lives in `shared/schemas/`
   and is consumed by both the client (form validation) and the server
   (request validation). One source of truth — don't hand-roll a second
   validator in a route.

3. **Add a doc.** If you add a cross-cutting mechanism, add a page in
   `docs/` and link it from `docs/README.md` and the top-level README.

4. **Match the code style.** The client is strict TypeScript with Tailwind
   utility classes; the server is CommonJS Express with inline JSDoc on
   every exported helper.

## If you change a shared schema

Re-generate the API contract so the docs stay in sync:

```bash
npm run openapi          # rewrites docs/openapi.json from shared/schemas
```

## Running the checks

```bash
npm run lint             # ESLint on utils/ + middleware/
npm run test:unit        # Node node:test unit suite (fast)
npm run cy:run           # full Cypress suite (~3 min)
```

CI runs `npm ci` → `prisma migrate deploy` → the full Cypress suite on every
push to `main` and every PR. Make sure everything is green locally first.

## Commit style

Small, focused commits with concise messages matching the existing history
(e.g. `fix(suites): searchable picker for add-cases toolbar`). Keep the
schema-shared + doc + test changes together in the same commit as the
feature they support.

## Code of conduct

By contributing, you agree to abide by the [Code of Conduct](./CODE_OF_CONDUCT.md).
