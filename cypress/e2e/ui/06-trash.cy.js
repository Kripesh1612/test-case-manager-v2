// =============================================================================
// UI tests: Trash — list, restore, purge.
//
// Flow:
//   1. Admin creates a case via the UI, then deletes it.
//   2. Visit /trash — the case appears in the trash list.
//   3. Click Restore — the case returns to /cases.
//   4. Delete again, visit /trash, click Purge — the case disappears.
// =============================================================================

describe('UI: /trash', () => {
  let adminToken;

  beforeEach(() => {
    cy.loginAsAdmin().then(({ user, token }) => {
      adminToken = token;
      cy.setAuthInBrowser(user, token);
    });
  });

  it('admin can delete a case, see it in /trash, and restore it', () => {
    const unique = `Trash UI ${Date.now()}`;

    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;

      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      cy.visit('/trash');
      cy.contains('[data-cy="trash-case-row"]', unique).should('be.visible');

      cy.contains('[data-cy="trash-case-row"]', unique)
        .find('[data-cy="trash-case-restore-btn"]')
        .click();
      cy.contains('[data-cy="trash-case-row"]', unique).should('not.exist');

      cy.visit('/cases');
      cy.contains('[data-cy="case-row"]', unique).should('be.visible');
    });
  });

  it('admin can purge a trashed case', () => {
    const unique = `Trash UI purge ${Date.now()}`;

    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });

      cy.visit('/trash');
      cy.contains('[data-cy="trash-case-row"]', unique).should('be.visible');

      cy.contains('[data-cy="trash-case-row"]', unique)
        .find('[data-cy="trash-case-purge-btn"]')
        .click();
      cy.get('[data-cy="modal-confirm"]').click();

      cy.contains('[data-cy="trash-case-row"]', unique).should('not.exist');
    });
  });

  it('trash tab is visible in the top nav', () => {
    cy.visit('/trash');
    cy.get('[data-cy="tab-trash"]').should('be.visible');
    cy.get('[data-cy="tab-trash"]').should('have.class', 'active');
  });

  it('empty state elements exist', () => {
    cy.visit('/trash');
    cy.get('[data-cy="trash-cases-empty"]').should('exist');
    cy.get('[data-cy="trash-suites-empty"]').should('exist');
  });
});