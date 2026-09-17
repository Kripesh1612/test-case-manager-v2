// =============================================================================
// API tests: /digest/* — Feature 2 (email digest).
//
// Covers:
//   - RBAC: non-admins get 403 on every digest route
//   - Preview: POST /digest/preview returns a composed digest without
//     persisting a digest_logs row
//   - Send now: POST /digest/send persists a digest_logs row (audit trail)
//     and reports delivery (artifact fallback when SMTP is unconfigured)
//   - History: GET /digest lists digest_logs, newest first
//
// The digest content itself (sections, HTML, .eml rendering) is unit-tested
// in utils/digest.test.js; this spec proves the routes + RBAC wiring.
// =============================================================================

describe('API: /digest/*', () => {
  let adminToken;
  let editorToken;
  let viewerToken;

  before(() => {
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
      return cy.register({ name: 'Dg Editor' });
    }).then(({ token }) => {
      editorToken = token;
      return cy.register({ name: 'Dg Viewer' });
    }).then(({ token }) => {
      viewerToken = token;
    });
  });

  it('non-admins are forbidden from digest routes', () => {
    cy.request({
      method: 'GET',
      url: '/digest',
      headers: { Authorization: `Bearer ${editorToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
    cy.request({
      method: 'POST',
      url: '/digest/send',
      headers: { Authorization: `Bearer ${viewerToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('POST /digest/preview composes without persisting a log', () => {
    cy.request({
      method: 'POST',
      url: '/digest/preview',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((resp) => {
      expect(resp.status).to.eq(200);
      expect(resp.body).to.have.property('title');
      expect(resp.body).to.have.property('sections');
      expect(resp.body).to.have.property('recipients');
      expect(resp.body.recipients.length).to.be.greaterThan(0);
      // No log_id → nothing was written to digest_logs.
      expect(resp.body.log_id).to.not.exist;
    });
  });

  it('POST /digest/send persists a digest_logs row', () => {
    cy.request({
      method: 'POST',
      url: '/digest/send',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((resp) => {
      expect(resp.status).to.eq(201);
      expect(resp.body.log_id).to.be.a('number');
      expect(resp.body.sections).to.be.an('array');
      expect(resp.body.recipients).to.be.an('array');
      // SMTP is unconfigured in tests → artifact fallback, not a socket push.
      expect(resp.body.delivery.delivered).to.eq(false);
    });
  });

  it('GET /digest lists digest history newest-first', () => {
    cy.request({
      method: 'POST',
      url: '/digest/send',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((sent) => {
      const sentId = sent.body.log_id;
      return cy.request({
        method: 'GET',
        url: '/digest',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((listResp) => {
        expect(listResp.status).to.eq(200);
        const ids = listResp.body.map((l) => l.id);
        expect(ids).to.include(sentId);
        const times = listResp.body.map((l) => new Date(l.sent_at).getTime());
        for (let i = 1; i < times.length; i += 1) {
          expect(times[i - 1]).to.be.gte(times[i]);
        }
      });
    });
  });
});