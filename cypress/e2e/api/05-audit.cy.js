// =============================================================================
// API tests: /audit/* — every mutation creates one event; non-admins 403.
// =============================================================================

describe('API: /audit/*', () => {
  let adminToken;
  let editorToken;
  let editorId;
  let viewerToken;

  before(() => {
    // Setup: create admin (already exists via 01-auth before()), and a
    // fresh editor + viewer for permission tests.
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
      return cy.register({ name: 'Audit Editor' });
    }).then(({ token, user }) => {
      editorToken = token;
      editorId = user.id;
      return cy.register({ name: 'Audit Viewer' });
    }).then(({ token, user }) => {
      viewerToken = token;
      // Demote viewer for realism; admin can do this via /users/:id/role.
      return cy.request({
        method: 'PUT',
        url: `/users/${user.id}/role`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { role: 'viewer' },
      });
    });
  });

  it('POST /test-cases writes one test_case.create event', () => {
    const unique = `Audit Case ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const createdId = resp.body.id;
      cy.request({
        method: 'GET',
        url: `/audit?target_type=test_case&target_id=${createdId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((auditResp) => {
        expect(auditResp.status).to.eq(200);
        expect(auditResp.body.events.length).to.be.at.least(1);
        const ev = auditResp.body.events[0];
        expect(ev.action).to.eq('test_case.create');
        expect(ev.target_type).to.eq('test_case');
        expect(ev.target_id).to.eq(createdId);
        expect(ev.actor.id).to.be.a('number');
      });
    });
  });

  it('PUT /test-cases/:id writes test_case.update with a before snapshot', () => {
    const unique = `Audit Update ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique, priority: 'low' },
    }).then((resp) => {
      const id = resp.body.id;
      return cy.request({
        method: 'PUT',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { priority: 'high' },
      }).then(() => id);
    }).then((id) => {
      return cy.request({
        method: 'GET',
        url: `/audit?target_type=test_case&target_id=${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((auditResp) => {
        const events = auditResp.body.events;
        const updateEvent = events.find((e) => e.action === 'test_case.update');
        expect(updateEvent, 'expected a test_case.update event').to.exist;
        expect(updateEvent.before).to.be.an('object');
        expect(updateEvent.before.priority).to.eq('low');
        expect(updateEvent.after.priority).to.eq('high');
      });
    });
  });

  it('DELETE /test-cases/:id writes test_case.delete with a before snapshot', () => {
    const unique = `Audit Delete ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      return cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then(() => id);
    }).then((id) => {
      return cy.request({
        method: 'GET',
        url: `/audit?action=test_case.delete&target_id=${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((auditResp) => {
        expect(auditResp.body.events.length).to.be.at.least(1);
        const ev = auditResp.body.events[0];
        expect(ev.action).to.eq('test_case.delete');
        expect(ev.target_id).to.eq(id);
      });
    });
  });

  it('filters by actor_id', () => {
    // Login as editor, create a case. The audit event should reference
    // the editor's user id, not the admin's.
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${editorToken}` },
      body: { title: `By editor ${Date.now()}` },
    }).then((resp) => {
      const createdId = resp.body.id;
      return cy.request({
        method: 'GET',
        url: `/audit?actor_id=${editorId}&target_id=${createdId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((auditResp) => {
        expect(auditResp.body.events.length).to.be.at.least(1);
        expect(auditResp.body.events[0].actor.id).to.eq(editorId);
      });
    });
  });

  it('viewer cannot read /audit (403)', () => {
    cy.request({
      method: 'GET',
      url: '/audit',
      headers: { Authorization: `Bearer ${viewerToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('editor cannot read /audit (403)', () => {
    cy.request({
      method: 'GET',
      url: '/audit',
      headers: { Authorization: `Bearer ${editorToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('anonymous cannot read /audit (401)', () => {
    cy.request({
      method: 'GET',
      url: '/audit',
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(401);
    });
  });

  it('response envelope has total/limit/offset', () => {
    cy.request({
      method: 'GET',
      url: '/audit',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((resp) => {
      expect(resp.body).to.have.keys(['total', 'limit', 'offset', 'events']);
      expect(resp.body.total).to.be.a('number');
      expect(resp.body.events).to.be.an('array');
    });
  });

  it('GET /audit/actions returns distinct action strings', () => {
    cy.request({
      method: 'GET',
      url: '/audit/actions',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body.actions).to.be.an('array');
      expect(resp.body.actions.length).to.be.at.least(1);
    });
  });

  it('audit does NOT record 4xx responses', () => {
    // Create a case and try to update it with invalid data; expect 400.
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Audit 4xx ${Date.now()}` },
    }).then((resp) => {
      const id = resp.body.id;
      return cy.request({
        method: 'PUT',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { title: '' }, // fails validation
        failOnStatusCode: false,
      }).then((putResp) => {
        expect(putResp.status).to.eq(400);
        // Now fetch audit; there should be NO test_case.update event for this id.
        return cy.request({
          method: 'GET',
          url: `/audit?target_id=${id}&action=test_case.update`,
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then((auditResp) => {
          expect(auditResp.body.events.length).to.eq(0);
        });
      });
    });
  });
});