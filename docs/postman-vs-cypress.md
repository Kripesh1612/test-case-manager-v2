# Postman vs Cypress

Both can hit the same endpoints. They overlap heavily but solve different
problems. This is the rule of thumb I use:

## Reach for **Postman** when…

- **You're exploring a new API.** Postman's UI is faster for poking at
  endpoints you don't understand yet. You can flip between body / headers /
  response, save a request to a collection, and iterate without writing any
  code.
- **You need to share a manual test plan with non-developers.** A Postman
  collection is a single JSON file anyone can import. A Cypress spec is a
  JavaScript file that requires Node + Cypress to run.
- **You want ad-hoc debugging.** "What does `/test-suites/3/run` return when
  I pass an empty array?" — Postman answers that in three seconds.
- **You're documenting the API.** Postman generates docs from the
  collection; Cypress doesn't.
- **The test is one-shot.** Scripts that set up environments, generate
  tokens, then run a single curl command — this is what Postman pre-request
  scripts are for.

## Reach for **Cypress** when…

- **You're asserting a contract.** "GET `/test-cases/:id` returns 404 with
  a JSON error envelope when the id doesn't exist." Cypress turns that into
  one line: `expect(resp.status).to.eq(404); expect(resp.body.error).to.match(/not found/i)`.
- **You're testing a UI flow.** Cypress drives a real browser. Postman
  cannot.
- **You need fixtures and dynamic data.** `cy.register()` creates a fresh
  user every run; no manual cleanup.
- **You want regression coverage.** Cypress runs on every commit (in CI).
  Postman collections are usually run by humans, on demand.
- **You're mocking the network.** `cy.intercept()` lets you simulate
  errors, latency, or alternative server shapes without needing the real
  server to misbehave. See `06-advanced-patterns.cy.js`.
- **You're testing RBAC.** Role-based access is best tested by running the
  same endpoint as each role and asserting the status code differs. See
  `api/04-users-rbac.cy.js` for the canonical example.

## How this project uses both

The same app is exercised three ways:

```
curl       →  for "I'm new here, let me poke at it"
Postman    →  for "let me share this manual test plan with my team"
Cypress    →  for "this needs to run on every commit"
```

Each layer is appropriate at a different moment in the development of a
feature. As an app matures, coverage drifts from curl/Postman (exploratory)
toward Cypress (regression).
