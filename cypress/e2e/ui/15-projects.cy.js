// =============================================================================
// UI E2E: /admin/projects + the project switcher (Feature 4).
//
// Covers:
//   - the projects page renders for admins (list or empty state)
//   - creating a project via the inline form appears in the table
//   - the topbar project switcher changes the active project (persisted badge)
//   - the Projects nav item is admin-only (not shown to editors)
// =============================================================================

describe('UI: projects page + switcher', () => {
  before(() => {
    return cy.loginAsAdmin().then(({ user, token }) => {
      return cy.setAuthInBrowser(user, token);
    });
  });

  beforeEach(() => {
    cy.visit('/admin/projects');
    cy.get('[data-cy="projects-table"], [data-cy="projects-empty"]', { timeout: 10_000 }).should('exist');
  });

  it('renders the projects page header', () => {
    cy.contains('Projects').should('be.visible');
    cy.contains('tenant boundary').should('be.visible');
  });

  it('creates a project from the form and lists it', () => {
    const name = `UI Project ${Date.now()}`;
    cy.get('[data-cy="projects-new-btn"]').click();
    cy.get('[data-cy="projects-form-card"]').should('be.visible');
    cy.get('[data-cy="project-name-input"]').type(name);
    cy.get('[data-cy="project-save-btn"]').click();
    // The new project appears as a (non-active) row.
    cy.get('[data-cy="project-row"]', { timeout: 10_000 }).should('be.visible');
    cy.get('[data-cy="project-name"]').contains(name).should('be.visible');
  });

  it('renames an existing project via the form', () => {
    cy.get('[data-cy="project-row"]', { timeout: 10_000 }).first().as('row');
    cy.get('@row').find('[data-cy="project-edit"]').click();
    const renamed = `Renamed ${Date.now()}`;
    cy.get('[data-cy="project-name-input"]').clear().type(renamed);
    cy.get('[data-cy="project-save-btn"]').click();
    cy.get('[data-cy="project-name"]', { timeout: 10_000 }).contains(renamed).should('be.visible');
  });

  it('the topbar switcher persists the active project', () => {
    // Open the switcher, capture the current active project name, then pick
    // a different project and assert the badge updates.
    cy.get('[data-cy="project-picker"]').should('be.visible');
    cy.get('[data-cy="project-picker"]').click();
    cy.get('[role="menu"]').should('be.visible');
    cy.get('[data-cy="project-picker-active"]')
      .invoke('text')
      .then((activeName) => {
        cy.get(`[data-cy="project-picker-option"]:not(:contains("${activeName}"))`)
          .first()
          .click();
        cy.get('[data-cy="project-picker-active"]').then(($el) => {
          expect($el.text().trim()).not.to.eq(activeName.trim());
        });
      });
  });

  it('the current project is marked as active in the table', () => {
    cy.get('[data-cy="project-picker-active"]').invoke('text').then((activeName) => {
      cy.get('[data-cy="project-row"]').filter((_i, el) => {
        return el.querySelector('[data-cy="project-name"]')?.textContent?.trim() === activeName.trim();
      }).first().as('activeRow');
      cy.get('@activeRow').should('have.attr', 'data-active', 'true');
      cy.get('@activeRow').find('[data-cy="project-active"]').should('exist');
    });
  });
});

describe('UI: projects RBAC', () => {
  it('the Projects nav item is not shown to editors', () => {
    return cy.register({ name: 'Prj UI Editor' }).then(({ user, token }) => {
      cy.setAuthInBrowser(user, token);
      cy.visit('/');
      cy.get('[data-cy="tab-projects"]').should('not.exist');
    });
  });

  it('editors visiting /admin/projects are redirected away', () => {
    return cy.register({ name: 'Prj UI Editor 2' }).then(({ user, token }) => {
      cy.setAuthInBrowser(user, token);
      cy.visit('/admin/projects');
      cy.url().should('not.include', '/admin/projects');
    });
  });
});