# Learning path

> Goal: take someone who has never written a Cypress test from zero to
> confident, using this codebase as the canvas.

The project is set up so that **every QA-relevant concept is exercised
somewhere in the test suite**. You don't need to imagine scenarios — they're
all here. Read in order; each step builds on the last.

## 0. Get the app running

```bash
npm install
npm run db:up        # Postgres 16 via docker-compose
npm run db:wait      # block until it accepts connections
npx prisma migrate dev --name init   # first time only
node index.js                        # runs on http://localhost:3001
```

Or use the all-in-one path: `npm run docker:up` brings up both Postgres
and the Node app in containers.

Open the URL in a browser. Click around. Get a feel for what the app does.
This matters more than it sounds — you'll write better tests once you have
muscle memory for the UI.

## 1. Drive the API with `curl` (or Postman)

Before tests exist, the API needs to be a thing you can talk to. From the
terminal:

```bash
# Public health check
curl http://localhost:3001/

# Register a user (returns token + user object)
curl -X POST http://localhost:3001/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"me@example.com","password":"password123","name":"Me"}'

# Create a test case (use the token from the response above)
curl -X POST http://localhost:3001/test-cases \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{"title":"Login with valid creds","priority":"high"}'
```

**What you should learn here:** the request shape, the response shape, the
auth header convention. None of this needs Cypress.

## 2. Move into Postman

Open `postman/Test-Case-Manager.postman_collection.json` in Postman. The
collection's pre-request scripts will auto-register users with unique
emails so your run never collides with another person's.

Walk through the collection in order:

1. **Auth → Register** — creates a user and stores the token in the
   collection's environment.
2. **Auth → Login** — verifies the token works.
3. **Test Cases → Create** — uses the stored token automatically.
4. **Test Cases → List** — confirms the create worked.

**What you should learn here:** how variables + environments make a
collection portable across runs and across teammates, and how pre-request
scripts let you avoid hardcoded fixtures.

## 3. Now open Cypress

```bash
npm run cy:open
```

Choose **E2E Testing**, pick a browser, then walk through the specs in this
order:

| # | Spec                       | What it teaches                             |
| - | -------------------------- | ------------------------------------------- |
| 1 | `api/01-auth.cy.js`        | How `cy.request()` becomes a contract test |
| 2 | `api/02-test-cases.cy.js`  | CRUD assertions, validation error shapes    |
| 3 | `api/03-test-suites.cy.js` | Many-to-many relationships, status codes    |
| 4 | `api/04-users-rbac.cy.js`  | Role-based access control, 401 vs 403       |
| 5 | `ui/01-auth.cy.js`         | UI login/logout, `data-cy` selectors        |
| 6 | `ui/02-cases.cy.js`        | CRUD through the UI, search + filters       |
| 7 | `ui/03-suites.cy.js`       | Detail-page flows, run-all behaviour        |
| 8 | `ui/04-dashboard.cy.js`    | Charts + stats render correctly             |
| 9 | `ui/05-admin.cy.js`        | Admin-only page gating, role promotion      |
| 10 | `ui/06-advanced-patterns.cy.js` | `cy.intercept()` + `cy.fixture()` — mocking |

Don't run all 215 tests in one go the first time. Run them one spec at a
time. Watch the Cypress UI. Read the source while the test is open.

## 4. Read the patterns

Once you've watched a few specs run, open
[`cypress-patterns.md`](./cypress-patterns.md) and the docs that interest
you. They explain *why* each pattern is used.

## 5. Read the bugs

Open [`bugs-caught-by-tests.md`](./bugs-caught-by-tests.md). Every entry is
a real defect that the tests caught while the project was being built.
This is where QA earns its keep — most of these wouldn't show up in
manual smoke testing.
