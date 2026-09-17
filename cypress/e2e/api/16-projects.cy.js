// =============================================================================
// API tests: /projects (Feature 4 — multi-tenant project management).
//
// Covers:
//   - RBAC: only admins can list/create/rename/switch projects
//   - Create + slug auto-derivation, duplicate-slug 409
//   - Rename / description patch, racket slug 409, unknown-project 404
//   - The switcher persists the admin's active project (visible via /auth/me)
//   - Tenancy isolation: cases created under one project are invisible
//     (list + GET) from another
// =============================================================================

describe('API: projects (multi-tenant)', () => {
  let adminToken;
  let editorToken;
  let viewerToken;

  const stamp = Date.now();

  before(() => {
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
      return cy.register({ name: 'Prj Editor' });
    }).then(({ token }) => {
      editorToken = token;
      return cy.request({
        method: 'POST',
        url: '/invites',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { email: `prj-viewer-${stamp}@example.com`, role: 'viewer' },
      });
    }).then(({ body }) => cy.request({
      method: 'POST',
      url: '/invites/redeem',
      body: { token: body.token, name: 'Prj Viewer', password: 'password123' },
    })).then((resp) => {
      viewerToken = resp.body.token;
    });
  });

  const me = (token) => cy.request({
    method: 'GET',
    url: '/auth/me',
    headers: { Authorization: `Bearer ${token}` },
  }).then((resp) => resp.body.user);

  it('only admins can list projects', () => {
    cy.request({
      method: 'GET',
      url: '/projects',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body.length).to.be.at.least(1);
      const p = resp.body[0];
      expect(p.name).to.be.a('string');
      expect(p).to.have.property('members');
      expect(p).to.have.property('test_cases');
      expect(p).to.have.property('test_suites');
      expect(p).to.have.property('scheduled_jobs');
      expect(p).to.have.property('webhooks');
    });
    cy.request({
      method: 'GET',
      url: '/projects',
      headers: { Authorization: `Bearer ${editorToken}` },
      failOnStatusCode: false,
    }).then((resp) => expect(resp.status).to.eq(403));
    cy.request({
      method: 'GET',
      url: '/projects',
      headers: { Authorization: `Bearer ${viewerToken}` },
      failOnStatusCode: false,
    }).then((resp) => expect(resp.status).to.eq(403));
    cy.request({
      method: 'GET',
      url: '/projects',
      failOnStatusCode: false,
    }).then((resp) => expect(resp.status).to.eq(401));
  });

  it('admins create projects, slug auto-derived from the name', () => {
    cy.request({
      method: 'POST',
      url: '/projects',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: `Growth QA ${stamp}`, description: 'Tenant A' },
    }).then((resp) => {
      expect(resp.status).to.eq(201);
      expect(resp.body.slug).to.eq(`growth-qa-${stamp}`);
      expect(resp.body.description).to.eq('Tenant A');
    });
    cy.request({
      method: 'POST',
      url: '/projects',
      headers: { Authorization: `Bearer ${editorToken}` },
      body: { name: 'Nope' },
      failOnStatusCode: false,
    }).then((resp) => expect(resp.status).to.eq(403));
    cy.request({
      method: 'POST',
      url: '/projects',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: {},
      failOnStatusCode: false,
    }).then((resp) => expect(resp.status).to.eq(400));
  });

  it('duplicate slugs are rejected with 409', () => {
    cy.createProject(adminToken, { name: `Alpha ${stamp}` }).then((created) => {
      cy.request({
        method: 'POST',
        url: '/projects',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'Other', slug: created.slug },
        failOnStatusCode: false,
      }).then((resp) => expect(resp.status).to.eq(409));
    });
  });

  it('rename + description patch, slug clash 409 and unknown 404', () => {
    cy.createProject(adminToken, { name: `Beta ${stamp}` }).then((created) => {
      cy.request({
        method: 'PATCH',
        url: `/projects/${created.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: `Beta Renamed ${stamp}`, description: 'now described' },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.name).to.eq(`Beta Renamed ${stamp}`);
        expect(resp.body.description).to.eq('now described');
      });
      cy.request({
        method: 'PATCH',
        url: `/projects/${created.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { slug: 'default' },
        failOnStatusCode: false,
      }).then((resp) => expect(resp.status).to.eq(409));
      cy.request({
        method: 'PATCH',
        url: '/projects/999999',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'Ghost' },
        failOnStatusCode: false,
      }).then((resp) => expect(resp.status).to.eq(404));
    });
  });

  it('switching projects persists the active project on /auth/me', () => {
    cy.createProject(adminToken, { name: `SwitchTo ${stamp}` }).then((created) => {
      cy.request({
        method: 'POST',
        url: `/projects/${created.id}/switch`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.project_name).to.eq(`SwitchTo ${stamp}`);
      });
      me(adminToken).then((u) => {
        expect(u.projectId).to.eq(created.id);
        expect(u.project_name).to.eq(`SwitchTo ${stamp}`);
      });
      cy.request({
        method: 'POST',
        url: '/projects/999999/switch',
        headers: { Authorization: `Bearer ${adminToken}` },
        failOnStatusCode: false,
      }).then((resp) => expect(resp.status).to.eq(404));
    });
  });

  it('cases are isolated across projects', () => {
    cy.createProject(adminToken, { name: `Isol ${stamp}` }).then((created) => {
      const adminId = created.id;
      cy.request({
        method: 'POST',
        url: `/projects/${adminId}/switch`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then(({ status }) => expect(status).to.eq(200));
      return cy.createTestCase(adminToken, { title: `isolated-a-${stamp}` }).then((caseA) => {
        // Switch back to the default project.
        cy.request({
          method: 'POST',
          url: '/projects/1/switch',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then(({ status }) => expect(status).to.eq(200));
        return cy.createTestCase(adminToken, { title: `isolated-b-${stamp}` }).then((caseB) => {
          // We are in the default project: caseB is visible (200), caseA (in
          // project A) is hidden (404).
          cy.request({
            method: 'GET',
            url: `/test-cases/${caseA.id}`,
            headers: { Authorization: `Bearer ${adminToken}` },
            failOnStatusCode: false,
          }).then((resp) => expect(resp.status).to.eq(404));
          cy.request({
            method: 'GET',
            url: `/test-cases/${caseB.id}`,
            headers: { Authorization: `Bearer ${adminToken}` },
          }).then((resp) => {
            expect(resp.status).to.eq(200);
            expect(resp.body.title).to.eq(`isolated-b-${stamp}`);
          });
          // The default project's list has only case B.
          cy.request({
            method: 'GET',
            url: '/test-cases',
            headers: { Authorization: `Bearer ${adminToken}` },
          }).then((resp) => {
            const titles = resp.body.map((c) => c.title);
            expect(titles).to.include(`isolated-b-${stamp}`);
            expect(titles).not.to.include(`isolated-a-${stamp}`);
          });
          // And switching back into A shows only case A.
          cy.request({
            method: 'POST',
            url: `/projects/${adminId}/switch`,
            headers: { Authorization: `Bearer ${adminToken}` },
          }).then(({ status }) => expect(status).to.eq(200));
          return cy.request({
            method: 'GET',
            url: '/test-cases',
            headers: { Authorization: `Bearer ${adminToken}` },
          }).then((resp) => {
            const titles = resp.body.map((c) => c.title);
            expect(titles).to.include(`isolated-a-${stamp}`);
            expect(titles).not.to.include(`isolated-b-${stamp}`);
          });
        });
      });
    });
  });
});