// =============================================================================
// UI E2E: auth flow — register, login, auth gate, logout
// =============================================================================
describe('UI: Authentication', () => {
  it('lands on /login first when visiting /', () => {
    cy.clearAuth();
    cy.visit('/');
    cy.url().should('include', '/login');
    cy.get('[data-cy="login-card"]').should('be.visible');
  });

  it('direct access to /cases while unauthenticated redirects to /login', () => {
    cy.clearAuth();
    cy.visit('/cases');
    cy.url().should('include', '/login');
  });

  it('logs in with valid credentials and lands on /cases', () => {
    cy.register({ name: 'UI Login Tester' }).then(({ email }) => {
      cy.visit('/login');
      cy.get('[data-cy="login-email"]').clear().type(email);
      cy.get('[data-cy="login-password"]').clear().type('password123');
      cy.get('[data-cy="login-submit"]').click();
      cy.url().should('include', '/cases');
      cy.get('[data-cy="profile-btn"]').should('be.visible');
    });
  });

  it('shows an error toast on bad credentials', () => {
    cy.visit('/login');
    cy.get('[data-cy="login-email"]').type('nobody@example.com');
    cy.get('[data-cy="login-password"]').type('wrong-password');
    cy.get('[data-cy="login-submit"]').click();
    cy.get('[data-cy="toast"][data-cy-toast="error"]').should('be.visible');
    cy.url().should('include', '/login');
  });

  it('switch link takes you to /register', () => {
    cy.visit('/login');
    cy.get('[data-cy="register-link"]').click();
    cy.url().should('include', '/register');
    cy.get('[data-cy="register-card"]').should('be.visible');
  });

  it('registering redirects to /login (no auto-login)', () => {
    // Make sure we start unauthenticated — earlier tests in the suite
    // (or in earlier specs sharing localStorage via testIsolation:false)
    // may have left a token in storage.
    cy.clearAuth();
    const email = `register-${Date.now()}@example.com`;
    cy.visit('/register');
    cy.get('[data-cy="register-name"]').type('New User');
    cy.get('[data-cy="register-email"]').type(email);
    cy.get('[data-cy="register-password"]').type('password123');
    cy.get('[data-cy="register-submit"]').click();
    // After successful register, we land on /login. The login form must
    // not be auto-filled (no auto-login). Token must also be absent.
    cy.url().should('include', '/login');
    cy.window().its('localStorage.tcm_token').should('not.exist');
    cy.get('[data-cy="login-email"]').should('have.value', '');
  });

  it('logout from the profile menu clears auth and redirects to /login', () => {
    cy.loginAsAdmin().then(({ user, token }) => {
      cy.setAuthInBrowser(user, token);
      cy.visit('/cases');
      cy.get('[data-cy="profile-btn"]').click();
      cy.get('[data-cy="logout-btn"]').click();
      cy.url().should('include', '/login');
      cy.window().its('localStorage.tcm_token').should('not.exist');
    });
  });

  it('profile dropdown shows the user role', () => {
    cy.loginAsAdmin().then(({ user, token }) => {
      cy.setAuthInBrowser(user, token);
      cy.visit('/dashboard');
      cy.get('[data-cy="profile-btn"]').click();
      cy.get('[data-cy="profile-role-admin"]').should('be.visible').and('contain', 'admin');
    });
  });
});
