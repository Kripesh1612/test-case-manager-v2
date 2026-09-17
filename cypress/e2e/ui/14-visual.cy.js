// =============================================================================
// UI E2E: /visual (admin/editor visual-regression page) — Feature 3.
//
// Covers:
//   - page renders for admins (ghost state + header)
//   - tab navigation is present for admins/editors
//   - empty state renders when no runs have a stored diff
//   (The full upload→diff→diff_image lifecycle is proven by
//    cypress/e2e/api/15-visual.cy.js + unit tests in utils/visualDiff.test.js)
// =============================================================================

describe('UI: /visual page', () => {
  before(() => {
    return cy.loginAsAdmin().then(({ user, token }) => {
      return cy.setAuthInBrowser(user, token);
    });
  });

  beforeEach(() => {
    cy.visit('/visual');
  });

  it('renders the visual-regression page header', () => {
    cy.contains('Visual regression').should('be.visible');
  });

  it('shows an empty state, or a populated table when diffs exist', () => {
    // Wait for the query to settle (loading → empty or ready), then assert
    // the corresponding content is present.
    cy.get('[data-cy="visual-root"]', { timeout: 10_000 })
      .should('have.attr', 'data-state')
      .and('match', /^(empty|ready)$/);
    cy.get('body').then(($body) => {
      const hasEmpty = $body.find('[data-cy="visual-empty"]').length > 0;
      const hasTable = $body.find('[data-cy="visual-table"]').length > 0;
      expect(hasEmpty || hasTable, 'renders empty state or the diff table').to.eq(true);
    });
  });

  it('the Visual nav item is present for admins', () => {
    cy.get('[data-cy="tab-visual"]').should('be.visible');
  });
});