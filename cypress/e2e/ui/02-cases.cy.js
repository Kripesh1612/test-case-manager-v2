// =============================================================================
// UI E2E: /cases — CRUD, search, filter, sort, bulk, tags, run cycle
// =============================================================================
describe('UI: Test Cases page', () => {
  let editor;
  let createdCaseIds = [];

  before(() => {
    cy.loginAsAdmin().then(({ user, token }) => {
      // Seed a couple of cases so tests that depend on existing data have it.
      // Cleanup runs in afterEach for cases created in tests, but these
      // belong to the suite's setup.
      cy.createTestCase(token, { title: `Setup case A ${Date.now()}` });
      cy.createTestCase(token, { title: `Setup case B ${Date.now()}` });
      cy.setAuthInBrowser(user, token);
      cy.visit('/cases');
    });
  });

  beforeEach(() => {
    // Re-auth before each test in case the previous one logged out
    cy.window().then((win) => {
      if (!win.localStorage.getItem('tcm_token')) {
        cy.loginAsAdmin().then(({ user, token }) => {
          cy.setAuthInBrowser(user, token);
        });
      }
    });
    cy.visit('/cases');
  });

  afterEach(() => {
    // Best-effort cleanup: delete any cases we created in this test
    cy.window().then((win) => {
      const tok = win.localStorage.getItem('tcm_token');
      if (tok && createdCaseIds.length) {
        createdCaseIds.forEach((id) => {
          cy.request({
            method: 'DELETE',
            url: `/test-cases/${id}`,
            headers: { Authorization: `Bearer ${tok}` },
            failOnStatusCode: false,
          });
        });
        createdCaseIds = [];
      }
    });
  });

  it('shows the cases page with toolbar and result count', () => {
    cy.get('[data-cy="toolbar"]').should('be.visible');
    cy.get('[data-cy="result-count"]').should('be.visible');
    cy.get('[data-cy="case-list"]').should('be.visible');
  });

  it('shows an empty state when there are no matching cases', () => {
    cy.get('[data-cy="search-input"]').clear().type('zzznonexistentqueryzzz');
    cy.get('[data-cy="empty-no-matches"]').should('be.visible');
    cy.get('[data-cy="reset-filters"]').click();
  });

  it('creates a new test case through the form', () => {
    const title = `UI created ${Date.now()}`;
    cy.get('[data-cy="case-new-btn"]').click();
    cy.get('[data-cy="case-form"]').should('be.visible');
    cy.get('[data-cy="case-title-input"]').type(title);
    cy.get('[data-cy="case-description-input"]').type('Created via UI test');
    cy.get('[data-cy="case-steps-input"]').type('step one\nstep two\nstep three');
    cy.get('[data-cy="case-priority-input"]').select('high');
    cy.get('[data-cy="case-submit-btn"]').click();
    cy.get('[data-cy="toast"][data-cy-toast="success"]').should('contain', 'created');
    cy.get('[data-cy="case-row"]').should('contain', title);

    // Capture for cleanup
    cy.request({
      url: '/test-cases',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
    }).then((resp) => {
      const found = resp.body.find((c) => c.title === title);
      if (found) createdCaseIds.push(found.id);
    });
  });

  it('search filters the list and highlights matches', () => {
    const unique = `searchtoken${Date.now()}`;
    cy.createTestCase(window.localStorage.getItem('tcm_token'), { title: `Contains ${unique} here` }).then((c) => {
      createdCaseIds.push(c.id);
      cy.reload();
      cy.get('[data-cy="search-input"]').type(unique);
      // Wait for the 200ms debounce + render
      cy.wait(300);
      cy.get('[data-cy="case-row"]').should('have.length.at.least', 1);
      cy.get('mark.hl').should('exist');
    });
  });

  it('clear-search button resets the search field', () => {
    cy.get('[data-cy="search-input"]').type('something');
    cy.get('[data-cy="clear-search-btn"]').should('be.visible').click();
    cy.get('[data-cy="search-input"]').should('have.value', '');
  });

  it('clicking a status chip filters the list', () => {
    cy.get('[data-cy="status-chip"][data-value="active"]').click();
    cy.get('[data-cy="status-chip"][data-value="active"]').should('have.class', 'active');
    // URL should reflect the filter
    cy.url().should('include', 'status=active');
  });

  it('clicking a priority chip filters the list', () => {
    cy.get('[data-cy="priority-chip"][data-value="high"]').click();
    cy.get('[data-cy="priority-chip"][data-value="high"]').should('have.class', 'active');
    cy.url().should('include', 'priority=high');
  });

  it('changing the sort dropdown reorders the list', () => {
    cy.get('[data-cy="sort-select"]').select('title_asc');
    cy.url().should('include', 'sort=title_asc');
  });

  it('run-status button cycles not_run → passed → failed → not_run', () => {
    cy.createTestCase(window.localStorage.getItem('tcm_token'), { title: 'Run cycle test' }).then((c) => {
      createdCaseIds.push(c.id);
      cy.reload();
      cy.get(`[data-case-id="${c.id}"]`).within(() => {
        cy.get('[data-cy="case-run-btn"]').should('have.class', 'result-not_run').click();
        cy.get('[data-cy="case-run-btn"]').should('have.class', 'result-passed').click();
        cy.get('[data-cy="case-run-btn"]').should('have.class', 'result-failed').click();
        cy.get('[data-cy="case-run-btn"]').should('have.class', 'result-not_run');
      });
    });
  });

  it('bulk selects two cases and shows the bulk bar', () => {
    cy.createTestCase(window.localStorage.getItem('tcm_token'), { title: 'Bulk 1' }).then((a) => {
      createdCaseIds.push(a.id);
      cy.createTestCase(window.localStorage.getItem('tcm_token'), { title: 'Bulk 2' }).then((b) => {
        createdCaseIds.push(b.id);
        cy.reload();
        cy.get(`[data-case-id="${a.id}"] [data-cy="case-checkbox"]`).check();
        cy.get(`[data-case-id="${b.id}"] [data-cy="case-checkbox"]`).check();
        cy.get('[data-cy="bulk-bar"]').should('be.visible');
        cy.get('[data-cy="bulk-count"]').should('have.text', '2');
        cy.get('[data-cy="bulk-clear"]').click();
        cy.get('[data-cy="bulk-bar"]').should('not.be.visible');
      });
    });
  });

  it('opens the confirm modal when clicking delete', () => {
    cy.createTestCase(window.localStorage.getItem('tcm_token'), { title: 'Delete me' }).then((c) => {
      createdCaseIds.push(c.id);
      cy.reload();
      cy.get(`[data-case-id="${c.id}"] [data-cy="case-delete-btn"]`).click();
      cy.get('[data-cy="modal"]').should('be.visible');
      cy.get('[data-cy="modal-title"]').should('contain', 'Delete');
      cy.get('[data-cy="modal-cancel"]').click();
      cy.get('[data-cy="modal"]').should('not.exist');
      // The case should still exist
      cy.get(`[data-case-id="${c.id}"]`).should('exist');
    });
  });

  it('clicking "Open Trash" on the success toast navigates to /trash', () => {
    cy.createTestCase(window.localStorage.getItem('tcm_token'), { title: 'Trash link target' }).then((c) => {
      // Don't push to createdCaseIds — we soft-delete it (it goes to /trash,
      // not the live list, so the afterEach bulk cleanup would 404 on it).
      const id = c.id;
      cy.reload();
      cy.get(`[data-case-id="${id}"] [data-cy="case-delete-btn"]`).click();
      cy.get('[data-cy="modal-confirm"]').click();
      // Success toast with the "Open Trash" action button.
      cy.get('[data-cy="toast"][data-cy-toast="success"]', { timeout: 8000 })
        .should('contain', 'Moved to Trash');
      cy.get('[data-cy="toast"][data-cy-toast="success"] [data-cy="toast-action"]')
        .should('have.text', 'Open Trash')
        .click();
      // Should land on /trash.
      cy.url().should('include', '/trash');
    });
  });

  it('adds tags through the tag input and removes them by clicking', () => {
    const title = `Tags test ${Date.now()}`;
    cy.get('[data-cy="case-new-btn"]').click();
    cy.get('[data-cy="case-title-input"]').type(title);
    cy.get('[data-cy="tag-input"]').type('smoke{enter}');
    cy.get('[data-cy="tag-input"]').type('auth{enter}');
    cy.get('[data-cy="tag-chip"]').should('have.length', 2);
    cy.get('[data-cy="tag-chip"]').first().click();
    cy.get('[data-cy="tag-chip"]').should('have.length', 1);
    cy.get('[data-cy="case-submit-btn"]').click();
    cy.get('[data-cy="toast"][data-cy-toast="success"]').should('exist');
    cy.request({
      url: '/test-cases',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
    }).then((resp) => {
      const found = resp.body.find((c) => c.title === title);
      if (found) createdCaseIds.push(found.id);
    });
  });
});
