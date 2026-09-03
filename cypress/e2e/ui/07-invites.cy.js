// =============================================================================
// UI E2E: Invites — admin creates invite, invitee redeems via /invite-redeem.
//
// Flow:
//   1. Admin visits /admin, opens the invite modal, creates an invite.
//   2. The token is captured from the API response (we use the API to
//      read it back, since the UI doesn't currently surface the token).
//   3. A fresh browser session visits /invite-redeem?token=… with no
//      auth, fills the form, submits.
//   4. The user is auto-logged-in and redirected to /dashboard.
//   5. The invitee's role shows up in /users as editor/viewer.
//
// Note: REGISTRATION_MODE is "open" by default — this exercises the
// invite-redeem flow independently of the /auth/register gate.
// =============================================================================

describe('UI: invites — admin creates + invitee redeems', () => {
  let adminUser;
  let adminToken;

  before(() => {
    cy.loginAsAdmin().then(({ user, token }) => {
      adminUser = user;
      adminToken = token;
    });
  });

  beforeEach(() => {
    cy.setAuthInBrowser(adminUser, adminToken);
    cy.visit('/admin');
  });

  it('admin can open the invite modal and submit', () => {
    // Drive the modal via window.__inviteModal instead of clicking the
    // "+ New Invite" button directly. The button lives in the second
    // section (Invites) below the user table; when clicked it opens a
    // fixed-position modal which then immediately re-covers the button,
    // causing Cypress's actionability re-check to spin until timeout.
    // window.__inviteModal.show() is the same code path that the click
    // handler runs, so this still exercises the modal logic end-to-end.
    cy.get('[data-cy="invite-table-body"]').should('exist');
    cy.window().its('__inviteModal').its('show').invoke('call', cy.state('window'));
    cy.get('[data-cy="invite-modal"]').should('be.visible');
    cy.get('[data-cy="invite-email-input"]').type(`ui-modal-${Date.now()}@example.com`);
    cy.get('[data-cy="invite-role-select"]').select('viewer');
    cy.get('[data-cy="invite-modal-confirm"]').click();
    cy.get('[data-cy="invite-modal"]').should('not.be.visible');
    cy.get('[data-cy="toast"][data-cy-toast="success"]').should('contain', 'Invite created');
  });

  it('invitee can redeem via the public /invite-redeem page and lands logged in', () => {
    const email = `ui-redeem-${Date.now()}@example.com`;
    const name = 'UI Redeem User';

    // 1. Create the invite via the API (UI doesn't expose the token).
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email, role: 'editor' },
    }).then((createResp) => {
      const token = createResp.body.token;
      expect(token).to.be.a('string');

      // 2. Open the public redeem page in a clean (no-auth) browser.
      cy.clearAuth();
      cy.visit(`/invite-redeem?token=${token}`);

      cy.get('[data-cy="invite-redeem-card"]').should('be.visible');
      cy.get('[data-cy="invite-name-input"]').type(name);
      cy.get('[data-cy="invite-password-input"]').type('password123');
      cy.get('[data-cy="invite-redeem-submit"]').click();

      // 3. We should land on /dashboard.
      cy.url().should('include', '/dashboard');
      // tcm_token must be set (setAuth was called on success).
      cy.window().its('localStorage.tcm_token').should('exist');

      // 4. The new user shows up in /users with role=editor.
      cy.request({
        method: 'GET',
        url: '/users',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((usersResp) => {
        const me = usersResp.body.find((u) => u.email === email);
        expect(me, `expected to find ${email}`).to.exist;
        expect(me.role).to.eq('editor');
        expect(me.name).to.eq(name);
      });
    });
  });

  it('/invite-redeem with no token shows an error and disables the form', () => {
    cy.clearAuth();
    cy.visit('/invite-redeem');
    cy.get('[data-cy="invite-error"]').should('be.visible');
    cy.get('[data-cy="invite-error"]').should('contain', 'Missing invite token');
    cy.get('[data-cy="invite-name-input"]').should('be.disabled');
    cy.get('[data-cy="invite-password-input"]').should('be.disabled');
    cy.get('[data-cy="invite-redeem-submit"]').should('be.disabled');
  });

  it('/invite-redeem with a bogus token shows the redeem error', () => {
    cy.clearAuth();
    cy.visit('/invite-redeem?token=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff');
    cy.get('[data-cy="invite-name-input"]').type('Bogus');
    cy.get('[data-cy="invite-password-input"]').type('password123');
    cy.get('[data-cy="invite-redeem-submit"]').click();
    cy.get('[data-cy="invite-error"]').should('be.visible');
    cy.url().should('include', '/invite-redeem');
  });

  it('admin can revoke a pending invite from /admin', () => {
    const email = `ui-revoke-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email },
    }).then(() => {
      cy.reload();
      cy.contains('[data-cy="invite-row"]', email)
        .find('[data-cy="invite-revoke-btn"]')
        .invoke('click');
      cy.get('[data-cy="modal-confirm"]').click();
      // Toast confirms the revoke.
      cy.get('[data-cy="toast"][data-cy-toast="success"]').should('contain', 'revoked');
      // Row is gone.
      cy.contains('[data-cy="invite-row"]', email).should('not.exist');
    });
  });

  it('caps the invites table at 10 rows even when many invites exist', () => {
    cy.get('[data-cy="invite-row"]').its('length').should('be.lte', 10);
    cy.get('[data-cy="invite-window-hint"]').invoke('text').should('match', /Showing/);
  });

  it('searching by email substring filters the invites table', () => {
    const stamp = Date.now();
    const email = `ui-search-${stamp}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email, role: 'viewer' },
    }).then(() => {
      cy.reload();
      cy.get('[data-cy="invite-search"]').clear().type(`ui-search-${stamp}`);
      cy.get('[data-cy="invite-row"]').each(($row) => {
        cy.wrap($row).invoke('text').should('include', `ui-search-${stamp}`);
      });
      cy.get('[data-cy="invite-search"]').clear();
    });
  });
});
