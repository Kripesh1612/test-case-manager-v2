// =============================================================================
// UI E2E: /dashboard
// =============================================================================
describe('UI: Dashboard', () => {
  before(() => {
    return cy.loginAsAdmin().then(({ user, token }) => {
      return cy.setAuthInBrowser(user, token);
    });
  });

  beforeEach(() => {
    cy.visit('/dashboard');
  });

  beforeEach(() => {
    // Sanity check: we should still be authenticated
    cy.visit('/dashboard');
    cy.url().should('include', '/dashboard');
  });

  it('shows the four stat cards', () => {
    cy.get('[data-cy="stat-total-cases"]').should('be.visible');
    cy.get('[data-cy="stat-total-suites"]').should('be.visible');
    cy.get('[data-cy="stat-pass-rate"]').should('be.visible');
    cy.get('[data-cy="stat-unrun"]').should('be.visible');
  });

  it('shows bar charts for status, priority, and result', () => {
    cy.get('[data-cy="status-bars"] [data-cy="bar-row"]').should('have.length', 3);
    cy.get('[data-cy="priority-bars"] [data-cy="bar-row"]').should('have.length', 3);
    cy.get('[data-cy="result-bars"] [data-cy="bar-row"]').should('have.length', 3);
  });

  it('tab navigation: clicking Cases navigates to /cases', () => {
    cy.get('[data-cy="tab-cases"]').click();
    cy.url().should('include', '/cases');
  });

  it('quick-link buttons navigate to cases/suites', () => {
    cy.get('[data-cy="link-to-cases"]').click();
    cy.url().should('include', '/cases');
    cy.go('back');
    cy.get('[data-cy="link-to-suites"]').click();
    cy.url().should('include', '/suites');
  });
});
