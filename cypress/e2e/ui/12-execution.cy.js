// =============================================================================
// UI tests: Phase 8 — Real Test Execution
//
// The RunPanel is mounted above the case-detail body. Two flows:
//
//   1. Case with a snippet → RunPanel renders, snippet textarea is
//      populated, the Run button is enabled for editors and disabled
//      for viewers.
//   2. Case without a snippet → RunPanel renders the disabled-state
//      "can't run" message and the editor opens the save-snippet
//      affordance by typing into the textarea.
//
// We intentionally DON'T click Run here: a real Cypress invocation
// takes 10-30 s and would extend the suite's runtime materially. The
// end-to-end "click Run → SSE → terminal status" flow is covered by
// a manual smoke + the API test (cypress/e2e/api/12-execution.cy.js)
// that verifies the POST creates a TestRun row. Keeping this test
// fast keeps the suite under its 2-minute budget.
// =============================================================================

describe('UI: Run execution', () => {
  let admin;
  let adminToken;
  let editorUser;
  let editorToken;
  let viewerUser;
  let viewerToken;

  let caseWithSnippet;
  let caseWithoutSnippet;

  before(() => {
    return cy
      .loginAsAdmin()
      .then(({ user, token }) => {
        admin = user;
        adminToken = token;
        return cy.setAuthInBrowser(user, token);
      })
      .then(() => cy.register({ name: 'Run Editor' }))
      .then(({ token, user }) => {
        editorToken = token;
        editorUser = user;
        // Default role is editor — no role update needed.
        return cy.register({ name: 'Run Viewer' });
      })
      .then(({ token, user }) => {
        viewerUser = user;
        viewerToken = token;
        return cy.request({
          method: 'PUT',
          url: `/users/${user.id}/role`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { role: 'viewer' },
        });
      })
      .then(() => cy.createTestCase(adminToken, {
        title: `run-with-snippet-${Date.now()}`,
        executable_snippet: "it('health', () => { cy.visit('/'); });",
      }))
      .then((created) => { caseWithSnippet = created; })
      .then(() => cy.createTestCase(adminToken, {
        title: `run-without-snippet-${Date.now()}`,
      }))
      .then((created) => { caseWithoutSnippet = created; });
  });

  beforeEach(() => {
    cy.window().then((win) => {
      if (!win.localStorage.getItem('tcm_token')) {
        cy.setAuthInBrowser(admin, adminToken);
      }
    });
  });

  it('renders the RunPanel on a case detail page with the snippet pre-loaded', () => {
    cy.visit(`/cases/${caseWithSnippet.id}`);
    // The panel always renders, even when the case has no snippet — the
    // affordance differs, but the panel itself is constant so the
    // dashboard layout doesn't reflow as users type.
    cy.get('[data-cy="run-panel"]').should('be.visible');
    cy.get('[data-cy="run-snippet-input"]')
      .should('be.visible')
      .and('have.value', "it('health', () => { cy.visit('/'); });");
    cy.get('[data-cy="run-btn"]').should('be.visible').and('not.be.disabled');
    // Status pill starts at idle.
    cy.get('[data-cy="run-status"]').should('have.attr', 'data-status', 'idle');
  });

  it('viewer sees the disabled RunPanel without an enabled action', () => {
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.setItem('tcm_token', viewerToken);
      win.localStorage.setItem('tcm_user', JSON.stringify(viewerUser));
    });
    cy.visit(`/cases/${caseWithSnippet.id}`);
    cy.get('[data-cy="run-panel"]').should('be.visible');
    // Run is rendered but disabled.
    cy.get('[data-cy="run-btn"]').should('be.disabled');
    // Snippet text-area is read-only for viewers.
    cy.get('[data-cy="run-snippet-input"]').should('be.disabled');
    // Hint is shown explaining why.
    cy.contains(/viewers cannot run tests/i).should('be.visible');
    // Restore admin auth so the next test's beforeEach doesn't fail.
    cy.window().then((win) => {
      win.localStorage.setItem('tcm_token', adminToken);
      win.localStorage.setItem('tcm_user', JSON.stringify(admin));
    });
  });

  it('enables the Save-snippet button when an editor changes the snippet on a snippet-less case', () => {
    // Log back in as the editor (an editor is allowed to edit, so we
    // get exactly the "Save snippet" affordance path).
    cy.visit('/login');
    cy.window().then((win) => {
      win.localStorage.setItem('tcm_token', editorToken);
      win.localStorage.setItem('tcm_user', JSON.stringify(editorUser));
    });
    cy.visit(`/cases/${caseWithoutSnippet.id}`);
    cy.get('[data-cy="run-panel"]').should('be.visible');
    cy.get('[data-cy="run-snippet-input"]').should('have.value', '');
    cy.get('[data-cy="run-snippet-save"]').should('not.exist');

    cy.get('[data-cy="run-snippet-input"]').clear().type("it('x', () => {});");
    cy.get('[data-cy="run-snippet-save"]').should('be.visible').and('not.be.disabled');
    // Restore admin for subsequent tests.
    cy.window().then((win) => {
      win.localStorage.setItem('tcm_token', adminToken);
      win.localStorage.setItem('tcm_user', JSON.stringify(admin));
    });
  });
});
