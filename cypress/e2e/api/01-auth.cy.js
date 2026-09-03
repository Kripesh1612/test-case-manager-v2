// =============================================================================
// API tests: /auth/*
// =============================================================================
// These run against the live server (cypress baseUrl). They hit the API
// directly — no browser, no UI rendering.
//
// Setup: the global before() hook in this folder ensures an admin user
// exists (cypress-admin@tcm.com). The matching email is in ADMIN_EMAILS,
// so the first /auth/register call creates them with role=admin.
// =============================================================================

const ADMIN_EMAIL = 'cypress-admin@tcm.com';
const ADMIN_PASSWORD = 'password123';

describe('API: /auth/*', () => {
  before(() => {
    // Try to register the admin. If they already exist, that's fine.
    cy.request({
      method: 'POST',
      url: '/auth/register',
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD, name: 'Cypress Admin' },
      failOnStatusCode: false,
    }).then((resp) => {
      // 201 = created, 409 = already registered — both acceptable
      expect([201, 409]).to.include(resp.status);
    });
  });

  describe('POST /auth/register', () => {
    it('registers a new user with role=editor by default', () => {
      cy.register().then(({ user, token }) => {
        expect(user).to.have.property('id');
        expect(user.email).to.match(/@example\.com$/);
        // Not in ADMIN_EMAILS → should be editor
        expect(user.role).to.eq('editor');
        expect(token).to.be.a('string').and.not.empty;
      });
    });

    it('promotes emails in ADMIN_EMAILS to role=admin', () => {
      // Make sure they exist (from before())
      cy.login(ADMIN_EMAIL, ADMIN_PASSWORD).then(({ user }) => {
        expect(user.role).to.eq('admin');
      });
    });

    it('rejects a duplicate email with 409', () => {
      const email = `dup-${Date.now()}@example.com`;
      cy.request({
        method: 'POST',
        url: '/auth/register',
        body: { email, password: 'password123', name: 'A' },
      });
      cy.request({
        method: 'POST',
        url: '/auth/register',
        body: { email, password: 'password123', name: 'B' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(409);
        expect(resp.body.error).to.match(/already/i);
      });
    });

    it('rejects invalid email with 400', () => {
      cy.request({
        method: 'POST',
        url: '/auth/register',
        body: { email: 'not-an-email', password: 'password123' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(400);
      });
    });

    it('rejects short password with 400', () => {
      cy.request({
        method: 'POST',
        url: '/auth/register',
        body: { email: `short-${Date.now()}@example.com`, password: 'short' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(400);
      });
    });
  });

  describe('POST /auth/login', () => {
    it('returns a token for valid credentials', () => {
      cy.register().then(({ email }) => {
        cy.login(email).then(({ user, token }) => {
          expect(user.email).to.eq(email);
          expect(token).to.be.a('string').and.not.empty;
        });
      });
    });

    it('rejects wrong password with 401', () => {
      cy.register().then(({ email }) => {
        cy.request({
          method: 'POST',
          url: '/auth/login',
          body: { email, password: 'wrong-password' },
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status).to.eq(401);
        });
      });
    });

    it('rejects unknown email with 401', () => {
      cy.request({
        method: 'POST',
        url: '/auth/login',
        body: { email: `nope-${Date.now()}@example.com`, password: 'whatever' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(401);
      });
    });
  });

  describe('GET /auth/me', () => {
    it('returns the current user when authenticated', () => {
      cy.loginAsAdmin().then(({ token, user }) => {
        cy.request({
          url: '/auth/me',
          headers: { Authorization: `Bearer ${token}` },
        }).then((resp) => {
          expect(resp.status).to.eq(200);
          expect(resp.body.user.email).to.eq(user.email);
          expect(resp.body.user.role).to.eq('admin');
        });
      });
    });

    it('returns 401 with no Authorization header', () => {
      cy.request({
        url: '/auth/me',
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(401);
      });
    });

    it('returns 401 with a bogus token', () => {
      cy.request({
        url: '/auth/me',
        headers: { Authorization: 'Bearer not-a-real-token' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(401);
      });
    });
  });
});
