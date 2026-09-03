// =============================================================================
// Advanced Cypress patterns: cy.intercept() + cy.fixture()
//
// The rest of the suite talks to the real server. This file demonstrates two
// patterns that become important once a UI grows past CRUD:
//
//   1. cy.intercept()  — listen for a network request and either:
//        - mock the response (so the test doesn't need the real server),
//        - assert what the page sent (e.g. "did the form actually POST?"),
//        - return a different status (for error-state UX tests).
//
//   2. cy.fixture()   — load JSON data from cypress/fixtures/ rather than
//        hard-coding it in the spec. Good for static payloads you reuse.
//
// Combined, you can write a test that exercises the UI's reaction to a
// particular server response (success, empty list, error) without needing
// the real server to be in that state.
// =============================================================================
describe('Advanced: cy.intercept() + cy.fixture()', () => {
  let cachedCase;

  before(() => {
    return cy.loginAsAdmin().then(({ user, token }) => {
      return cy.setAuthInBrowser(user, token);
    });
  });

  before(() => {
    // Load the fixture once and stash it on the closure so individual tests
    // don't each have to re-await `cy.fixture()`.
    return cy.fixture('test-case.json').then((f) => { cachedCase = f; });
  });

  // ---------- cy.fixture() basics ----------

  it('cy.fixture() loads JSON from cypress/fixtures/', () => {
    cy.fixture('test-case.json').then((data) => {
      expect(data).to.have.property('title', 'Login with valid credentials');
      expect(data.tags).to.include('smoke');
      expect(data.priority).to.eq('high');
    });
  });

  it('users.json fixture gives us one user per role', () => {
    cy.fixture('users.json').then((users) => {
      expect(users.admin.role).to.eq('admin');
      expect(users.editor.role).to.eq('editor');
      expect(users.viewer.role).to.eq('viewer');
      for (const role of ['admin', 'editor', 'viewer']) {
        expect(users[role]).to.have.all.keys('email', 'password', 'name', 'role');
      }
    });
  });

  // ---------- cy.intercept() mocking responses ----------

  it('cy.intercept() can MOCK a network response — no real server call needed', () => {
    // The page renders case-rows from whatever /test-cases returns.
    // Stub the response with inline JSON (a real list, with `steps` arrays
    // because the row template reads c.steps.length).
    const fakeList = [
      { id: 1, title: 'From the fake server (A)', result: 'passed',  status: 'active', priority: 'high',   tags: ['mock'], steps: ['one'] },
      { id: 2, title: 'From the fake server (B)', result: 'failed',  status: 'draft',  priority: 'medium', tags: ['mock'], steps: ['one', 'two'] },
      { id: 3, title: 'From the fake server (C)', result: 'not_run', status: 'active', priority: 'low',    tags: ['mock'], steps: [] },
    ];
    cy.intercept('GET', '/test-cases', { statusCode: 200, body: fakeList }).as('cases');

    cy.visit('/cases');
    cy.wait('@cases');
    cy.get('[data-cy="result-count-value"]').should('have.text', '3');
    cy.get('[data-cy="case-row"]').should('have.length', 3);
    cy.contains('[data-cy="case-title"]', 'From the fake server (B)').should('be.visible');
  });

  it('cy.intercept() can ASSERT what the page sent', () => {
    // Stub both the list and the create so the page is predictable, then
    // assert the REQUEST body matches what the form should have built.
    cy.intercept('POST', '/test-cases', { statusCode: 201, body: { id: 999, title: 'intercepted' } }).as('createCase');
    cy.intercept('GET',  '/test-cases', { statusCode: 200, body: [] }).as('listCases');

    cy.visit('/cases');
    cy.wait('@listCases');

    cy.get('[data-cy="case-new-btn"]').click();
    cy.get('[data-cy="case-title-input"]').type('Sent via intercept');
    cy.get('[data-cy="case-submit-btn"]').click();

    cy.wait('@createCase').its('request.body').should('deep.include', {
      title: 'Sent via intercept',
      status: 'draft',
      priority: 'medium',
    });
  });

  // ---------- cy.intercept() with the { fixture } shorthand ----------

  it('cy.intercept() can pass a fixture path as the response body', () => {
    // Cypress reads, parses, and serves the file as the response. Useful
    // when the same JSON is needed across many tests. Here we just verify
    // that the response body matches what the fixture file contains.
    cy.intercept('GET', '/test-cases', { fixture: 'test-case.json', statusCode: 200 }).as('cases');

    cy.visit('/cases');
    cy.wait('@cases').its('response.body').should('deep.include', {
      title: 'Login with valid credentials',
      priority: 'high',
    });
  });

  // ---------- cy.intercept() for error and auth scenarios ----------

  it('cy.intercept() can force a 401 to verify the auth gate kicks the user out', () => {
    // Simulate an expired/invalid token by mocking /auth/me with 401.
    // requireAuth catches this and redirects to /login — that's the
    // behaviour we want to assert.
    cy.intercept('GET', '/auth/me', { statusCode: 401, body: { error: 'Token expired' } }).as('me401');

    cy.visit('/cases');
    cy.wait('@me401');
    cy.url().should('include', '/login');
  });
});
