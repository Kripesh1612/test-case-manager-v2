// =============================================================================
// API tests: /test-cases/*
// =============================================================================
const ADMIN_EMAIL = 'cypress-admin@tcm.com';
const ADMIN_PASSWORD = 'password123';

describe('API: /test-cases/*', () => {
  let editor;

  before(() => {
    // Must RETURN the chain so Cypress waits for editor to be set before
    // any test runs. Forgetting the return is a classic gotcha.
    return cy.register({ name: 'Cases Editor' }).then((u) => {
      editor = u;
    });
  });

  describe('GET /test-cases', () => {
    it('lists test cases for any authenticated user', () => {
      cy.loginAsAdmin().then(({ token }) => {
        cy.request({
          url: '/test-cases',
          headers: { Authorization: `Bearer ${token}` },
        }).then((resp) => {
          expect(resp.status).to.eq(200);
          expect(resp.body).to.be.an('array');
        });
      });
    });

    it('returns 401 without a token', () => {
      cy.request({ url: '/test-cases', failOnStatusCode: false }).then((resp) => {
        expect(resp.status).to.eq(401);
      });
    });
  });

  describe('POST /test-cases', () => {
    it('creates a test case and returns it with an id', () => {
      cy.createTestCase(editor.token, {
        title: 'Login flow works',
        steps: ['Open /login', 'Enter creds', 'Submit'],
        tags: ['smoke', 'auth'],
      }).then((created) => {
        expect(created).to.have.property('id');
        expect(created.title).to.eq('Login flow works');
        expect(created.steps).to.deep.eq(['Open /login', 'Enter creds', 'Submit']);
        expect(created.tags).to.deep.eq(['smoke', 'auth']);
        expect(created.result).to.eq('not_run'); // default
        // Cleanup so we don't pollute the DB
        cy.deleteTestCase(editor.token, created.id);
      });
    });

    it('defaults result to not_run when omitted', () => {
      cy.createTestCase(editor.token, { title: 'No result specified' }).then((c) => {
        expect(c.result).to.eq('not_run');
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('accepts valid result values', () => {
      cy.createTestCase(editor.token, { title: 'Passed case', result: 'passed' }).then((c) => {
        expect(c.result).to.eq('passed');
        expect(c.last_run_at).to.not.be.null;
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('rejects invalid status with 400', () => {
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${editor.token}` },
        body: { title: 'Bad status', status: 'not-a-status' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(400);
      });
    });

    it('rejects empty title with 400', () => {
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${editor.token}` },
        body: { title: '' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(400);
      });
    });
  });

  describe('PUT /test-cases/:id', () => {
    it('updates fields and stamps last_run_at when result changes', () => {
      cy.createTestCase(editor.token, { title: 'Original' }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { result: 'failed' },
        }).then((resp) => {
          expect(resp.body.result).to.eq('failed');
          expect(resp.body.last_run_at).to.not.be.null;
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });
  });

  describe('DELETE /test-cases/:id', () => {
    it('returns 204 and removes the case', () => {
      cy.createTestCase(editor.token, { title: 'To delete' }).then((c) => {
        cy.request({
          method: 'DELETE',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
        }).then((resp) => {
          expect(resp.status).to.eq(204);
        });
        cy.request({
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status).to.eq(404);
        });
      });
    });
  });

  describe('editor ownership enforcement (middleware/requireOwnership)', () => {
    let adminToken;
    let otherEditorToken;

    before(() => {
      // Pull an admin token and create a second editor so we can prove
      // editor-A cannot mutate editor-B's resources.
      return cy.loginAsAdmin().then(({ token }) => {
        adminToken = token;
        return cy.register({ name: 'Owner-B Editor' });
      }).then(({ token }) => {
        otherEditorToken = token;
      });
    });

    it('PUT /test-cases/:id from a different editor → 403', () => {
      cy.createTestCase(editor.token, { title: `owned-${Date.now()}` }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${otherEditorToken}` },
          body: { title: 'hijack attempt' },
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status, 'non-owner editor blocked').to.eq(403);
          // Original title preserved.
          cy.request({
            url: `/test-cases/${c.id}`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((r) => {
            expect(r.body.title).to.not.eq('hijack attempt');
          });
        });
      });
    });

    it('DELETE /test-cases/:id from a different editor → 403', () => {
      cy.createTestCase(editor.token, { title: `owned-del-${Date.now()}` }).then((c) => {
        cy.request({
          method: 'DELETE',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${otherEditorToken}` },
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status, 'non-owner editor blocked').to.eq(403);
          // Row still alive.
          cy.request({
            url: `/test-cases/${c.id}`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((r) => {
            expect(r.status).to.eq(200);
          });
        });
      });
    });

    it('PUT /test-cases/:id by the owning editor → 200', () => {
      cy.createTestCase(editor.token, { title: `own-update-${Date.now()}` }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { title: 'updated by owner' },
        }).then((resp) => {
          expect(resp.status).to.eq(200);
          expect(resp.body.title).to.eq('updated by owner');
        });
      });
    });

    it('PUT /test-cases/:id by an admin bypasses ownership → 200', () => {
      cy.createTestCase(editor.token, { title: `admin-override-${Date.now()}` }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { title: 'admin override' },
        }).then((resp) => {
          expect(resp.status).to.eq(200);
          expect(resp.body.title).to.eq('admin override');
        });
      });
    });
  });
});
