// =============================================================================
// UI E2E: /suites + /suites/:id
// =============================================================================
describe('UI: Test Suites page', () => {
  let createdSuiteIds = [];
  let createdCaseIds = [];

  before(() => {
    cy.loginAsAdmin().then(({ user, token }) => {
      cy.setAuthInBrowser(user, token);
    });
  });

  beforeEach(() => {
    cy.visit('/suites');
  });

  afterEach(() => {
    const tok = window.localStorage.getItem('tcm_token');
    createdSuiteIds.forEach((id) => {
      cy.request({ method: 'DELETE', url: `/test-suites/${id}`, headers: { Authorization: `Bearer ${tok}` }, failOnStatusCode: false });
    });
    createdCaseIds.forEach((id) => {
      cy.request({ method: 'DELETE', url: `/test-cases/${id}`, headers: { Authorization: `Bearer ${tok}` }, failOnStatusCode: false });
    });
    createdSuiteIds = [];
    createdCaseIds = [];
  });

  it('shows the suites page with toolbar', () => {
    cy.get('[data-cy="toolbar"]').should('be.visible');
    cy.get('[data-cy="suite-list"]').should('be.visible');
  });

  it('search filters the suites list', () => {
    const unique = `suitetoken${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-suites',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
      body: { name: `Suite ${unique}`, description: 'desc' },
    }).then((resp) => {
      createdSuiteIds.push(resp.body.id);
      cy.reload();
      cy.get('[data-cy="search-input"]').type(unique);
      cy.wait(300);
      cy.get('[data-cy="suite-row"]').should('have.length.at.least', 1);
    });
  });

  it('clicking a suite name navigates to its detail page', () => {
    cy.request({
      method: 'POST',
      url: '/test-suites',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
      body: { name: `Nav test ${Date.now()}` },
    }).then((resp) => {
      createdSuiteIds.push(resp.body.id);
      cy.reload();
      cy.contains(`[data-cy="suite-row"]`, `Nav test`).within(() => {
        cy.get('[data-cy="suite-name-link"]').click();
      });
      cy.url().should('match', /\/suites\/\d+$/);
      cy.get('[data-cy="suite-name"]').should('be.visible');
      cy.get('[data-cy="back-to-suites"]').click();
      cy.url().should('include', '/suites');
    });
  });
});

describe('UI: Suite detail page', () => {
  let suiteId;
  let caseIds = [];

  before(() => {
    cy.loginAsAdmin().then(({ user, token }) => {
      cy.setAuthInBrowser(user, token);
    });
  });

  beforeEach(() => {
    // Create 2 cases + a suite that contains them
    const tok = window.localStorage.getItem('tcm_token');
    cy.createTestCase(tok, { title: 'Detail A' }).then((a) => {
      caseIds.push(a.id);
      cy.createTestCase(tok, { title: 'Detail B' }).then((b) => {
        caseIds.push(b.id);
        cy.createTestSuite(tok, { name: `Detail suite ${Date.now()}`, test_case_ids: [a.id] }).then((s) => {
          suiteId = s.id;
          cy.visit(`/suites/${suiteId}`);
        });
      });
    });
  });

  afterEach(() => {
    const tok = window.localStorage.getItem('tcm_token');
    if (suiteId) cy.request({ method: 'DELETE', url: `/test-suites/${suiteId}`, headers: { Authorization: `Bearer ${tok}` }, failOnStatusCode: false });
    caseIds.forEach((id) => cy.request({ method: 'DELETE', url: `/test-cases/${id}`, headers: { Authorization: `Bearer ${tok}` }, failOnStatusCode: false }));
    suiteId = null;
    caseIds = [];
  });

  it('shows suite name, description, and stats', () => {
    cy.get('[data-cy="suite-name"]').should('be.visible');
    cy.get('[data-cy="stat-suite-case-count"]').should('have.text', '1');
    cy.get('[data-cy="stat-suite-passed"]').should('have.text', '0');
    cy.get('[data-cy="stat-suite-failed"]').should('have.text', '0');
    cy.get('[data-cy="stat-suite-notrun"]').should('have.text', '1');
  });

  it('adds a case to the suite via the searchable picker', () => {
    // Type to filter, click the matching option, then Add.
    cy.get('[data-cy="add-case-search"]').click();
    cy.get('[data-cy="add-case-options"]').should('be.visible');
    cy.get('[data-cy="add-case-options"] [data-cy="add-case-option"]').should(
      'have.length.at.least',
      1,
    );
    // Filter by a substring that uniquely identifies "Detail B" (which is
    // the case NOT already in the suite, so it's a candidate).
    cy.get('[data-cy="add-case-search"]').type('Detail B');
    cy.get('[data-cy="add-case-options"] [data-cy="add-case-option"]')
      .should('have.length', 1)
      .click();
    cy.get('[data-cy="add-case-btn"]').click();
    cy.get('[data-cy="toast"][data-cy-toast="success"]').should('contain', 'Added');
    cy.get('[data-cy="stat-suite-case-count"]').should('have.text', '2');
  });

  it('shows a "no matches" message when the search has no results', () => {
    cy.get('[data-cy="add-case-search"]').click();
    cy.get('[data-cy="add-case-search"]').type('zzz-no-such-case');
    cy.get('[data-cy="add-case-options"]').should('contain', 'No test cases match');
  });

  it('removes a case via the × button (with confirmation)', () => {
    cy.get('[data-cy="suite-case-row"] [data-cy="remove-case-btn"]').first().click();
    cy.get('[data-cy="modal"]').should('be.visible');
    cy.get('[data-cy="modal-confirm"]').click();
    cy.get('[data-cy="toast"][data-cy-toast="success"]').should('contain', 'Removed');
    cy.get('[data-cy="stat-suite-case-count"]').should('have.text', '0');
  });

  it('Run All marks every member case as passed', () => {
    cy.get('[data-cy="run-all-btn"]').click();
    cy.get('[data-cy="modal-confirm"]').click();
    cy.get('[data-cy="toast"][data-cy-toast="success"]').should('contain', 'passed');
    cy.get('[data-cy="stat-suite-passed"]').should('have.text', '1');
    cy.get('[data-cy="stat-suite-notrun"]').should('have.text', '0');
  });

  it('cycles run status on a member case', () => {
    cy.get('[data-cy="suite-case-run-btn"]').should('have.class', 'result-not_run').click();
    cy.get('[data-cy="suite-case-run-btn"]').should('have.class', 'result-passed');
    cy.get('[data-cy="stat-suite-passed"]').should('have.text', '1');
  });
});
