# Bugs caught by the test suite

These are real defects that surfaced while this project was being built.
Each entry is a worked example of *how tests catch what manual QA misses*.

## 1. Suite-detail page was silently broken

**Symptom:** every test for `/suites/:id` failed — "could not find
`[data-cy="suite-case-row"]`".

**Root cause:** the HTML used `<script src="shared.js">`. When the URL was
`/suites/45`, the browser resolved that to `/suites/shared.js`, which the
server returned as the 404 HTML page. The browser tried to parse HTML as
JS and threw `SyntaxError: Unexpected token '<'`. `requireAuth()` never
ran, so the page was stuck on the awaiting-auth state with `visibility:
hidden`.

**How the tests caught it:** the UI spec asserts DOM elements that are only
rendered after `requireAuth()` resolves. The suite-detail spec was the
first one to navigate to a sub-path, so it was the first to fail.

**The fix:** changed every `<script src="…">` and `<link href="…">` in
`public/*.html` to absolute paths (`/shared.js`, `/cases.js`, …).

## 2. First click on "+ New Test Case" had no tag input

**Symptom:** the test "adds tags through the tag input" timed out trying to
type into `[data-cy="tag-input"]`.

**Root cause:** chips and the input were created by `renderTagChips()`,
which was only called inside `resetCaseForm()`. `resetCaseForm()` runs
when the form is *hidden*. The very first click of "+ New Test Case" went
through `showCaseForm()`, which never called `renderTagChips()` and never
created the input.

**How the tests caught it:** the spec exercises the *first* click, not
just any click. Manual QA would have likely hit the button a second time
and seen the input appear, blaming "cache".

**The fix:** `showCaseForm()` now falls back to `renderTagChips()` if the
tag `<input>` doesn't already exist.

## 3. Bulk action bar got clipped on short viewports

**Symptom:** `cy.get('[data-cy="bulk-bar"]').should('be.visible')` failed
with "this element is not visible because its ancestor has `position:
fixed` and it is overflowed by other elements".

**Root cause:** `.bulk-bar` was `position: sticky; bottom: 1rem` inside a
non-scrolling container. Sticky positioning does nothing without scroll,
but the bottom value still created a layout that other elements could
overflow.

**How the tests caught it:** only an automated test asserts visibility in a
headless browser at the configured viewport — a manual tester with a tall
window would never see it.

**The fix:** switched to `position: relative`.

## 4. Cypress wiped `localStorage` between tests, breaking auth setup

**Symptom:** `04-dashboard.cy.js` had 1 passing test and 3 failures that
all said "expected `/login` to include `/dashboard`".

**Root cause:** Cypress's default `testIsolation: true` wipes
`localStorage` between tests. The `before()` set up auth, but by the
second test's `beforeEach()`, the token was gone.

**How the tests caught it:** themselves. The error was at the *test
runner* level — once we added `testIsolation: false` to
`cypress.config.js`, all four dashboard tests passed.

## 5. PUT `/test-cases/:id` for a viewer returned 403 with no body

**Symptom:** payload schema test asserted `expect(resp.body.error).to.match(/forbidden/i)` and failed.

**Root cause:** the middleware wrote a message containing the role *name*
("Forbidden — role 'viewer' cannot…") but the test regex didn't account
for the embedded quotes.

**How the tests caught it:** the contract test was stricter than the
implementation, surfacing a docs/implementation mismatch.

**The fix:** simplified the message to "Forbidden" (no role name) so the
regex matches consistently.

## 6. `before()` hooks without `return` looked fine until the second test

**Symptom:** flaky "second test in describe block fails" pattern, in
multiple files.

**Root cause:** `before(() => { cy.foo().then(...) })` — no `return`. The
chain ended before the async setup completed, so Cypress started running
the first test before auth was ready. Test 1 usually got lucky because
the setup happened to finish first.

**How the tests caught it:** failure showed up only when a *second* test
in the describe block ran. Tracked down by adding a `cy.url()` sanity
assertion at the top of the second test.

**The fix:** added `return` to every `before()` that does async setup.

---

## What these have in common

- Each bug was caught by an automated test, **not** by a human noticing
  weird behaviour.
- Each one would have been plausible to ship — the suite-detail page
  *looked* fine in development because the developer manually reloaded
  after each navigation.
- Each one points to a category of bug humans are bad at catching:
  paths that are only wrong in specific URL shapes; state that only
  matters on first interaction; layout that only fails at small viewports;
  timing that only fails on the *N*th iteration.

That's the case for writing tests before you finish the feature.
