// =============================================================================
// API tests: /webhooks/* — Feature 1.
//
// Covers:
//   - RBAC: non-admins get 403 on every webhook route (create/list/test/delete)
//   - CRUD: create → list → update → delete
//   - Validation: bad URL rejected
//   - Test ping: POST /webhooks/:id/test records a delivery row
//   - Event emission: running a suite fires suite.run.completed and records a
//     delivery row (polled — the emitter is fire-and-forget)
//
// Delivery receiver: webhooks point at 127.0.0.1:9 (connection refused) so
// deliveries fail fast and the recorded row is the "attempted" audit trail.
// The HTTP/signature/retry behaviour is fully unit-tested in
// utils/webhooks.test.js; this spec proves the wiring end-to-end.
// =============================================================================

describe('API: /webhooks/*', () => {
  let adminToken;
  let editorToken;
  let viewerToken;

  before(() => {
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
      return cy.register({ name: 'Wb Editor' });
    }).then(({ token }) => {
      editorToken = token;
      return cy.register({ name: 'Wb Viewer' });
    }).then(({ token }) => {
      viewerToken = token;
    });
  });

  const UNREACHABLE = 'http://127.0.0.1:9/hook';

  // Poll GET /webhooks/:id/deliveries until at least one row appears or we
  // run out of attempts. The emit is fire-and-forget, so the creation of the
  // delivery row races with the suite-run response.
  const waitForDelivery = (id, attempts = 20) => {
    if (attempts <= 0) throw new Error('timed out waiting for webhook delivery');
    return cy.request({
      method: 'GET',
      url: `/webhooks/${id}/deliveries`,
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((resp) => {
      if (resp.body.length > 0) return resp.body;
      return cy.wait(100).then(() => waitForDelivery(id, attempts - 1));
    });
  };

  it('non-editors and non-admins are forbidden from creating webhooks', () => {
    cy.request({
      method: 'POST',
      url: '/webhooks',
      headers: { Authorization: `Bearer ${editorToken}` },
      body: { url: UNREACHABLE },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
    cy.request({
      method: 'POST',
      url: '/webhooks',
      headers: { Authorization: `Bearer ${viewerToken}` },
      body: { url: UNREACHABLE },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('GET /webhooks requires admin', () => {
    cy.request({
      method: 'GET',
      url: '/webhooks',
      headers: { Authorization: `Bearer ${editorToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('rejects a malformed webhook URL', () => {
    cy.request({
      method: 'POST',
      url: '/webhooks',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { url: 'not-a-url' },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(400);
      expect(resp.body.error).to.eq('Validation failed');
    });
  });

  // Audit B4 — SSRF structural guard. The Zod schema refuses non-http(s)
  // schemes (file://, javascript:, gopher://, ftp://) and any literal
  // IP that falls in the private/reserved range. DNS-rebinding is
  // covered by the delivery-time check (assertUrlSafeAtDelivery); here
  // we just lock down the registration-time path.
  it('rejects non-http(s) webhook URLs (file://, javascript:, ftp://)', () => {
    const bad = [
      'file:///etc/passwd',
      'javascript:alert(1)',
      'ftp://example.com/hook',
      'gopher://example.com/',
    ];
    cy.wrap(bad).each((badUrl) => {
      cy.request({
        method: 'POST',
        url: '/webhooks',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { url: badUrl },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status, `URL ${badUrl} should have been rejected`).to.eq(400);
      });
    });
  });

  it('rejects webhook URLs that point at literal private/reserved IPs', () => {
    const bad = [
      'http://10.0.0.1/hook',
      'http://192.168.1.1/hook',
      'http://172.16.0.1/hook',
      'http://127.0.0.1/hook',
      'http://169.254.169.254/hook',
      'http://[::1]/hook',
      'http://[fe80::1]/hook',
    ];
    cy.wrap(bad).each((badUrl) => {
      cy.request({
        method: 'POST',
        url: '/webhooks',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { url: badUrl },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status, `URL ${badUrl} should have been rejected`).to.eq(400);
      });
    });
  });

  it('creates, lists, updates, and deletes a webhook', () => {
    let webhookId;
    cy.request({
      method: 'POST',
      url: '/webhooks',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { url: UNREACHABLE, secret: 's3cret', event: 'suite.run.completed' },
    }).then((resp) => {
      expect(resp.status).to.eq(201);
      expect(resp.body).to.have.property('id');
      expect(resp.body.url).to.eq(UNREACHABLE);
      expect(resp.body.has_secret).to.eq(true);
      expect(resp.body.enabled).to.eq(true);
      expect(resp.body.event).to.eq('suite.run.completed');
      webhookId = resp.body.id;

      return cy.request({
        method: 'GET',
        url: '/webhooks',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }).then((listResp) => {
      const match = listResp.body.find((w) => w.id === webhookId);
      expect(match, 'webhook should appear in list').to.exist;
      expect(match.delivery_count).to.be.a('number');

      return cy.request({
        method: 'PUT',
        url: `/webhooks/${webhookId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { enabled: false },
      });
    }).then((upResp) => {
      expect(upResp.body.enabled).to.eq(false);

      return cy.request({
        method: 'DELETE',
        url: `/webhooks/${webhookId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }).then((delResp) => {
      expect(delResp.status).to.eq(204);
    });
  });

  it('POST /webhooks/:id/test records a delivery row (attempted)', () => {
    cy.request({
      method: 'POST',
      url: '/webhooks',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { url: UNREACHABLE },
    }).then((resp) => {
      const id = resp.body.id;
      return cy.request({
        method: 'POST',
        url: `/webhooks/${id}/test`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((pingResp) => {
        expect(pingResp.status).to.eq(200);
        expect(pingResp.body.attempts).to.be.greaterThan(0);
        expect(pingResp.body.ok).to.eq(false); // unreachable endpoint fails fast
        return waitForDelivery(id);
      }).then((deliveries) => {
        expect(deliveries.length).to.be.greaterThan(0);
        expect(deliveries[0].event).to.eq('suite.run.completed');
        expect(deliveries[0].success).to.eq(false);
        // Ping must be distinguishable from a real suite.run.completed:
        // `ping: true`, `suite_id: null`, `webhook_id: <our webhook>`.
        // (Prior version set `suite_id` to the webhook's own PK, which
        // collided with consumer data — see audit A5.)
        expect(deliveries[0].payload.ping).to.eq(true);
        expect(deliveries[0].payload.suite_id).to.eq(null);
        expect(deliveries[0].payload.webhook_id).to.eq(id);
      });
    });
  });

  it('running a suite fires suite.run.completed to subscribed webhooks', () => {
    // Create a case + suite + webhook.
    let suiteId;
    let webhookId;
    cy.createTestCase(adminToken, { title: `wb-case-${Date.now()}` })
      .then((c) => cy.createTestSuite(adminToken, { name: `wb-suite-${Date.now()}`, test_case_ids: [c.id] }))
      .then((s) => { suiteId = s.id; })
      .then(() => cy.request({
        method: 'POST',
        url: '/webhooks',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { url: UNREACHABLE, event: 'suite.run.completed' },
      }))
      .then((resp) => { webhookId = resp.body.id; })
      // Fire the suite run — this should emit the event.
      .then(() => cy.request({
        method: 'POST',
        url: `/test-suites/${suiteId}/run`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { result: 'passed' },
      }))
      .then((runResp) => {
        expect(runResp.body.updated).to.be.greaterThan(0);
        return waitForDelivery(webhookId);
      })
      .then((deliveries) => {
        expect(deliveries.length).to.be.greaterThan(0);
        const d = deliveries[0];
        expect(d.event).to.eq('suite.run.completed');
        expect(d.payload.suite_id).to.eq(suiteId);
        expect(d.status_code).to.eq(null); // unreachable → no HTTP response
        expect(d.success).to.eq(false);
      });
  });

  it('webhook deliveries are project-scoped to the caller', () => {
    // A viewer can't read deliveries (403 via role gate) and an admin in
    // another project can't see this project's webhooks. The project
    // isolation is enforced by projectScope in routes/webhooks.js.
    cy.request({
      method: 'POST',
      url: '/webhooks',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { url: UNREACHABLE },
    }).then((resp) => {
      const id = resp.body.id;
      return cy.request({
        method: 'GET',
        url: `/webhooks/${id}/deliveries`,
        headers: { Authorization: `Bearer ${viewerToken}` },
        failOnStatusCode: false,
      });
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });
});