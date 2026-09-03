// =============================================================================
// UI E2E: /admin (admin-only) + RBAC enforcement in the UI
// =============================================================================
describe('UI: /admin page', () => {
  before(() => {
    return cy.loginAsAdmin().then(({ user, token }) => {
      return cy.setAuthInBrowser(user, token);
    });
  });

  beforeEach(() => {
    cy.visit('/admin');
  });

  it('shows the admin table with at least one row (the admin themselves)', () => {
    cy.get('[data-cy="admin-table"]').should('be.visible');
    cy.get('[data-cy="admin-user-row"]').should('have.length.at.least', 1);
  });

  it('total users stat shows the full count even when table is windowed', () => {
    // The header stat is the total in the DB, not the number of rendered rows.
    // The table is capped at 10 rows (latest first, admins on top).
    // Wait for JS to finish fetching /users before reading the stat.
    cy.get('[data-cy="admin-user-row"]').should('have.length.at.least', 1);
    cy.get('[data-cy="admin-user-total"]').invoke('text').then((totalText) => {
      const total = parseInt(totalText, 10);
      expect(total).to.be.gte(1);
      cy.get('[data-cy="admin-user-row"]').its('length').should('be.lte', 10);
      // Sanity: the stat should be at least as many rows as we can see.
      cy.get('[data-cy="admin-user-row"]').its('length').should('be.lte', total);
    });
  });

  it('caps the users table at 10 rows even when many users exist', () => {
    cy.get('[data-cy="admin-user-row"]').its('length').should('be.lte', 10);
    // The hint should reflect the window when the total is larger.
    cy.get('[data-cy="admin-user-window-hint"]').invoke('text').should('match', /Showing/);
  });

  it('admin users appear before non-admin users in the table', () => {
    // Seed: every admin in the rendered window must precede every non-admin row.
    cy.get('[data-cy="admin-user-row"]').then(($rows) => {
      const rows = $rows.toArray().map((r) => ({
        id: r.getAttribute('data-user-id'),
        isAdmin: r.querySelector('.role-pill.role-admin') !== null,
      }));
      const firstNonAdmin = rows.findIndex((r) => !r.isAdmin);
      if (firstNonAdmin === -1) return;          // all rows are admins — nothing to check
      const tail = rows.slice(firstNonAdmin);
      tail.forEach((r) => expect(r.isAdmin).to.eq(false));
    });
  });

  it('searching by email substring filters the users table', () => {
    cy.register({ name: 'Searchable User' }).then(({ email }) => {
      cy.reload();
      const needle = email.split('@')[0];         // unique-ish substring
      cy.get('[data-cy="admin-user-search"]').clear().type(needle);
      // Every visible row should match the search.
      cy.get('[data-cy="admin-user-row"]').each(($row) => {
        cy.wrap($row).invoke('text').should('include', needle);
      });
      cy.get('[data-cy="admin-users-empty"]').should('not.be.visible');
      // Clear and confirm the rows come back.
      cy.get('[data-cy="admin-user-search"]').clear();
      cy.get('[data-cy="admin-user-row"]').its('length').should('be.gt', 0);
    });
  });

  it('searching with no matches shows the empty state', () => {
    cy.get('[data-cy="admin-user-search"]').clear().type('zzzz-no-such-user');
    cy.get('[data-cy="admin-user-row"]').should('have.length', 0);
    cy.get('[data-cy="admin-users-empty"]').should('be.visible');
  });

  it('the current user row is highlighted and their controls are disabled', () => {
    cy.get('[data-cy="admin-user-row"].row-self').should('exist');
    cy.get('[data-cy="admin-user-row"].row-self').within(() => {
      cy.get('[data-cy="admin-role-select"]').should('be.disabled');
      cy.get('[data-cy="admin-delete-btn"]').should('be.disabled');
    });
  });

  it('changing another user\'s role shows a confirmation modal', () => {
    cy.register({ name: 'Admin test target' }).then(({ email }) => {
      cy.reload();
      cy.contains('[data-cy="admin-user-row"]', email).within(() => {
        cy.get('[data-cy="admin-role-select"]').select('viewer');
      });
      cy.get('[data-cy="modal"]').should('be.visible');
      cy.get('[data-cy="modal-title"]').should('contain', 'role');
      cy.get('[data-cy="modal-cancel"]').click();
      // Row should still show the original role
      cy.contains('[data-cy="admin-user-row"]', email).within(() => {
        cy.get('[data-cy="admin-role-select"]').should('have.value', 'editor');
      });
    });
  });

  it('promotes a user to viewer and sees the success toast', () => {
    cy.register({ name: 'Promote target' }).then(({ email }) => {
      cy.reload();
      cy.contains('[data-cy="admin-user-row"]', email).within(() => {
        cy.get('[data-cy="admin-role-select"]').select('viewer');
      });
      cy.get('[data-cy="modal-confirm"]').click();
      cy.get('[data-cy="toast"][data-cy-toast="success"]').should('contain', 'viewer');
    });
  });
});

describe('UI: RBAC visible in the UI', () => {
  it('viewer sees a read-only banner and no New buttons', () => {
    cy.loginAsAdmin().then(({ token: adminToken, user: adminUser }) => {
      // Create a viewer via API + promote via admin
      cy.register({ name: 'UI Viewer' }).then(({ email, user, token }) => {
        cy.request({
          method: 'PUT',
          url: `/users/${user.id}/role`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { role: 'viewer' },
        });
        // Login as the viewer in the browser
        cy.setAuthInBrowser({ ...user, role: 'viewer' }, token);
        cy.visit('/cases');
        cy.get('[data-cy="readonly-banner"]').should('be.visible');
        // The button still exists in the DOM but is hidden by the role-viewer
        // CSS rule (`body.role-viewer [data-writable] { display: none }`).
        cy.get('[data-cy="case-new-btn"]').should('not.be.visible');
        // Restore admin auth so later tests are unaffected
        cy.setAuthInBrowser(adminUser, adminToken);
      });
    });
  });

  it('non-admin hitting /admin is redirected to /dashboard', () => {
    cy.loginAsAdmin().then(({ admin }) => {
      cy.register({ name: 'Non-admin trying /admin' }).then(({ user, token }) => {
        cy.setAuthInBrowser(user, token);
        cy.visit('/admin');
        cy.url().should('include', '/dashboard');
      });
    });
  });

  it('admin sees the Admin tab, editor does not', () => {
    cy.loginAsAdmin().then(({ user, token }) => {
      cy.setAuthInBrowser(user, token);
      cy.visit('/dashboard');
      cy.get('[data-cy="tab-admin"]').should('be.visible');
    });

    cy.register({ name: 'Tab test editor' }).then(({ user, token }) => {
      cy.setAuthInBrowser(user, token);
      cy.visit('/dashboard');
      // editor is not admin, so the Admin tab remains hidden
      cy.get('[data-cy="tab-admin"]').should('not.be.visible');
    });
  });
});
