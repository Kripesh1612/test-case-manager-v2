# Cypress fixtures

JSON files loaded with `cy.fixture('name')` inside a test. Use them when:

- the test data is **static** and would otherwise be repeated inline
- you want to **mock the network** by handing the fixture to `cy.intercept()`
- you're sharing the same data across multiple specs

The fixture is just a JSON file — Cypress parses it and hands you the value.
You don't need to register it anywhere.

## Files in this folder

| File               | Used by                                                  |
| ------------------ | -------------------------------------------------------- |
| `test-case.json`   | `e2e/06-mocking.cy.js` — sample body for a fake POST     |
| `test-suite.json`  | `e2e/06-mocking.cy.js` — sample body for a fake PUT      |
| `users.json`       | `e2e/06-mocking.cy.js` — three roles in one fixture      |
| `tags.json`        | Available for any spec that needs a known tag vocabulary |

The rest of the suite generates its own data on the fly with custom commands
(`cy.register`, `cy.createTestCase`, etc.) because each test wants a fresh,
isolated dataset. Fixtures are reserved for the patterns shown in `06-mocking.cy.js`.
