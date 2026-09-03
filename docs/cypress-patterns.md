# Cypress patterns used in this project

Every pattern that appears in the test suite, with a one-line "why".

## Custom commands (`cypress/support/commands.js`)

```js
cy.register({ name: 'Cases Editor' })            // returns { email, user, token }
cy.login(email)                                   // returns the same shape
cy.loginAsAdmin()                                 // logs in the seeded admin
cy.setAuthInBrowser(user, token)                  // plants token in localStorage
cy.createTestCase(token, { title: '…' })          // returns the created case
cy.api(token).get('/test-cases')                  // thin wrapper over cy.request
```

**Why:** the test bodies should read like *intent* ("login as admin and
create a case"), not like HTTP plumbing. Hide the auth header, hide the
response shape, expose only what the test needs.

## `before()` returns the promise chain

```js
before(() => {
  return cy.loginAsAdmin().then(({ user, token }) => {
    return cy.setAuthInBrowser(user, token);
  });
});
```

**Why:** if you forget the `return`, Cypress doesn't wait for the async
setup before running the first test. The symptom is "test 1 passes, test 2
fails because the localStorage it expected to be set wasn't yet".

## `testIsolation: false` (`cypress.config.js`)

```js
e2e: { testIsolation: false }
```

**Why:** by default Cypress wipes localStorage between tests. If you set up
auth in `before()`, every test starts unauthenticated and the next
`beforeEach()` finds nothing to reuse. Disabling isolation makes the login
survive across tests in a spec.

## Variables in chained `.then()` callbacks don't share scope

```js
return cy.createTestCase(editor.token, { title: 'A' })
  .then((a) => cy.createTestCase(editor.token, { title: 'B' }).then((b) => ({ a, b })))
  .then(({ a, b }) => cy.createTestCase(editor.token, { title: 'C' }).then((c) => {
    cases = [a, b, c];
  }));
```

**Why:** a `const` declared inside a `.then()` callback is gone by the
next one. To pass multiple async results across `.then()` boundaries, you
either return an object (`{ a, b }`) or assign to an outer `let`.

## `cy.request()` returns a full response object

```js
const resp = await cy.request({ method: 'POST', url: '/test-cases', body: {...} }).then(r => r);
expect(resp.status).to.eq(201);
expect(resp.body.id).to.be.a('number');         // the JSON body
```

**Why:** many Cypress tutorials assume `cy.request()` returns the body. It
doesn't — it returns a Cypress chain that resolves to a response object
with `.status`, `.body`, `.headers`.

## `data-cy` everywhere on the UI

Every interactive element in `public/*.html` has a `data-cy` attribute:
buttons, inputs, list rows, toasts, modals, role pills.

**Why:** tests select by `[data-cy="…"]`. CSS classes change, IDs are
sometimes duplicated, text breaks i18n. `data-cy` is a contract between
the UI and the test, owned by no other concern.

## Two-layer test strategy: API + UI

```
api/*.cy.js    →  contract tests using cy.request (no browser)
ui/*.cy.js     →  end-to-end tests using cy.visit + cy.get (real browser)
```

**Why:** API tests are fast and pinpoint server-side regressions. UI tests
catch JS errors and DOM-level bugs. The API tests run first, fail first,
and tell you whether the bug is in the server or the UI.

## `cy.intercept()` for stubs and assertions

```js
cy.intercept('POST', '/test-cases').as('createCase');    // assert later
cy.intercept('GET',  '/test-cases', { fixture: 'x.json' }); // stub
cy.intercept('GET',  '/auth/me',   { statusCode: 401 });  // force error
```

**Why:** you don't always want to depend on a real server being in a
particular state. See `06-advanced-patterns.cy.js` for the full set.

## `afterEach()` cleanup that uses localStorage

```js
afterEach(() => {
  const tok = window.localStorage.getItem('tcm_token');
  // delete fixtures using API, even though we set them up via API too
});
```

**Why:** between tests, the DB still has whatever the previous test
created. If you didn't clean up, test N+1 sees test N's data. The
`afterEach` runs requests as the currently-logged-in user (read from
localStorage) so cleanup survives a role change mid-spec.

## What's deliberately NOT used

- **Page Object Model.** For a suite this size, POM adds indirection
  without saving duplication. The custom commands in
  `cypress/support/commands.js` already hide the boring stuff.
- **`cy.task()` for DB seeding.** Seeding via API in `before()` keeps the
  tests readable and self-contained.
- **Component testing.** This app doesn't have a component framework; the
  whole app is vanilla JS in `<script>` tags.
