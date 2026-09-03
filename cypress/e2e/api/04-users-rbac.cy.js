// =============================================================================
// API tests: /users/*  +  RBAC enforcement across all resources
// =============================================================================
describe('API: RBAC enforcement', () => {
  let admin;
  let editor;
  let viewer;
  let adminCaseId;

  before(() => {
    return cy.loginAsAdmin()
      .then((a) => {
        admin = a;
        return cy.register({ name: 'E2E Editor' });
      })
      .then((e) => {
        editor = e;
        return cy.register({ name: 'E2E Viewer' });
      })
      .then((v) => {
        viewer = v;
        // Promote viewer via admin
        return cy.request({
          method: 'GET',
          url: '/users',
          headers: { Authorization: `Bearer ${admin.token}` },
        }).then((resp) => {
          const found = resp.body.find((u) => u.email === viewer.email);
          return cy.request({
            method: 'PUT',
            url: `/users/${found.id}/role`,
            headers: { Authorization: `Bearer ${admin.token}` },
            body: { role: 'viewer' },
          });
        });
      });
  });

  describe('RBAC: viewer', () => {
    it('can GET test cases (read-only)', () => {
      cy.request({
        url: '/test-cases',
        headers: { Authorization: `Bearer ${viewer.token}` },
      }).then((resp) => expect(resp.status).to.eq(200));
    });

    it('cannot POST test cases (403)', () => {
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${viewer.token}` },
        body: { title: 'Viewer tries to write' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(403);
        expect(resp.body.error).to.match(/forbidden/i);
      });
    });

    it('cannot PUT test cases (403)', () => {
      cy.request({
        url: '/test-cases',
        headers: { Authorization: `Bearer ${admin.token}` },
      }).then((resp) => {
        const someId = resp.body[0]?.id;
        if (!someId) return; // nothing to update — skip
        cy.request({
          method: 'PUT',
          url: `/test-cases/${someId}`,
          headers: { Authorization: `Bearer ${viewer.token}` },
          body: { title: 'hijack' },
          failOnStatusCode: false,
        }).then((r) => expect(r.status).to.eq(403));
      });
    });

    it('cannot DELETE test cases (403)', () => {
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${editor.token}` },
        body: { title: 'Created by editor' },
      }).then((resp) => {
        const createdId = resp.body.id;
        // Viewer attempt — must be 403
        cy.request({
          method: 'DELETE',
          url: `/test-cases/${createdId}`,
          headers: { Authorization: `Bearer ${viewer.token}` },
          failOnStatusCode: false,
        }).then((r) => {
          expect(r.status).to.eq(403);
        });
        // Editor cleans up
        cy.request({
          method: 'DELETE',
          url: `/test-cases/${createdId}`,
          headers: { Authorization: `Bearer ${editor.token}` },
        });
      });
    });

    it('cannot POST test suites (403)', () => {
      cy.request({
        method: 'POST',
        url: '/test-suites',
        headers: { Authorization: `Bearer ${viewer.token}` },
        body: { name: 'Viewer suite' },
        failOnStatusCode: false,
      }).then((resp) => expect(resp.status).to.eq(403));
    });
  });

  describe('RBAC: editor', () => {
    it('can POST test cases (201)', () => {
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${editor.token}` },
        body: { title: 'Editor writes' },
      }).then((resp) => {
        expect(resp.status).to.eq(201);
        adminCaseId = resp.body.id;
        // cleanup
        cy.request({
          method: 'DELETE',
          url: `/test-cases/${adminCaseId}`,
          headers: { Authorization: `Bearer ${editor.token}` },
        });
      });
    });

    it('cannot access /users (403)', () => {
      cy.request({
        url: '/users',
        headers: { Authorization: `Bearer ${editor.token}` },
        failOnStatusCode: false,
      }).then((resp) => expect(resp.status).to.eq(403));
    });
  });

  describe('RBAC: admin', () => {
    it('can list users', () => {
      cy.request({
        url: '/users',
        headers: { Authorization: `Bearer ${admin.token}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body).to.be.an('array');
      });
    });

    it('cannot demote themselves (400)', () => {
      cy.request({
        method: 'PUT',
        url: `/users/${admin.user.id}/role`,
        headers: { Authorization: `Bearer ${admin.token}` },
        body: { role: 'editor' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(400);
      });
    });

    it('cannot delete themselves (400)', () => {
      cy.request({
        method: 'DELETE',
        url: `/users/${admin.user.id}`,
        headers: { Authorization: `Bearer ${admin.token}` },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(400);
      });
    });

    it('can promote and demote another user', () => {
      cy.request({
        method: 'PUT',
        url: `/users/${editor.user.id}/role`,
        headers: { Authorization: `Bearer ${admin.token}` },
        body: { role: 'viewer' },
      }).then((resp) => {
        expect(resp.body.role).to.eq('viewer');
      });
      // Restore to editor
      cy.request({
        method: 'PUT',
        url: `/users/${editor.user.id}/role`,
        headers: { Authorization: `Bearer ${admin.token}` },
        body: { role: 'editor' },
      }).then((resp) => {
        expect(resp.body.role).to.eq('editor');
      });
    });
  });

  describe('No token at all', () => {
    it('returns 401 on protected endpoints', () => {
      ['/auth/me', '/test-cases', '/test-suites', '/users'].forEach((url) => {
        cy.request({ url, failOnStatusCode: false }).then((resp) => {
          expect(resp.status).to.eq(401);
        });
      });
    });
  });
});
