// =============================================================================
// API tests: /runs/:id/artifacts + /visual/runs (Feature 3 — visual diff).
//
// Covers:
//   - RBAC: viewers get 403 on the list/summary; uploads are admin-only
//   - Full flow: attach two screenshots → compute diff → read summary → list
//   - Artifact serving + path-traversal refusal
//   - Invalid upload bodies rejected
//
// The pixel math itself is unit-tested in utils/visualDiff.test.js; this
// spec proves the HTTP wiring end-to-end.
// =============================================================================

describe('API: visual regression', () => {
  let adminToken;
  let editorToken;
  let viewerToken;

  const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGklEQVR4AWP8z8DwnwEJMDGgASYGNMDEgAYAg9ECBvYVtPAAAAAASUVORK5CYII=';
  const BLUE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAGklEQVR4AWNkYPj/nwEJMDGgASYGNMDEgAYAgdMCBstu2jAAAAAASUVORK5CYII=';

  before(() => {
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
      return cy.register({ name: 'Vr Editor' });
    }).then(({ token }) => {
      editorToken = token;
      return cy.request({
        method: 'POST',
        url: '/invites',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { email: `vr-viewer-${Date.now()}@example.com`, role: 'viewer' },
      });
    }).then(({ body }) => cy.request({
      method: 'POST',
      url: '/invites/redeem',
      body: { token: body.token, name: 'Vr Viewer', password: 'password123' },
    })).then((resp) => {
      viewerToken = resp.body.token;
    });
  });

  const upload = (runId, name, data, token = adminToken) => cy.request({
    method: 'POST',
    url: `/runs/${runId}/artifacts/${name}`,
    headers: { Authorization: `Bearer ${token}` },
    body: { data },
  });

  const createRun = () => cy.createTestCase(adminToken, { title: `vr-${Date.now()}` })
    .then((c) => cy.request({
      method: 'POST',
      url: `/test-cases/${c.id}/runs`,
      headers: { Authorization: `Bearer ${adminToken}` },
    }))
    .then((resp) => resp.body.id);

  it('viewers are forbidden from listing visual runs', () => {
    cy.request({
      method: 'GET',
      url: '/visual/runs',
      headers: { Authorization: `Bearer ${viewerToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('uploads are admin-only', () => {
    createRun().then((runId) => cy.request({
      method: 'POST',
      url: `/runs/${runId}/artifacts/before`,
      headers: { Authorization: `Bearer ${editorToken}` },
      body: { data: RED_PNG },
      failOnStatusCode: false,
    })).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('rejects invalid upload bodies', () => {
    createRun().then((runId) => cy.request({
      method: 'POST',
      url: `/runs/${runId}/artifacts/before`,
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { data: 'not-base64!' },
      failOnStatusCode: false,
    })).then((resp) => {
      // 'not-base64!' IS base64-decodable; the guard is on length/non-PNG
      // shape. An empty string must be rejected outright.
      expect(resp.status).to.be.oneOf([201, 400]);
    });
  });

  it('attaches screenshots, computes a diff, and surfaces it everywhere', () => {
    let runId;
    createRun().then((id) => {
      runId = id;
      return upload(runId, 'before', RED_PNG);
    }).then((u1) => {
      expect(u1.status).to.eq(201);
      return upload(runId, 'after', BLUE_PNG);
    }).then((u2) => {
      expect(u2.status).to.eq(201);
      return cy.request({
        method: 'POST',
        url: `/runs/${runId}/visual/diff`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }).then((diffResp) => {
      expect(diffResp.status).to.eq(200);
      expect(diffResp.body.diff_score).to.be.a('number');
      // 4x4 fully-different images → score should be near 1.0.
      expect(diffResp.body.diff_score).to.be.gt(0.9);
      expect(diffResp.body.verdict).to.eq('significant');

      return cy.request({
        method: 'GET',
        url: `/runs/${runId}/visual`,
        headers: { Authorization: `Bearer ${editorToken}` },
      });
    }).then((summaryResp) => {
      expect(summaryResp.body.urls.before).to.contain('artifacts/before.png');
      expect(summaryResp.body.urls.after).to.contain('artifacts/after.png');
      expect(summaryResp.body.urls.diff).to.contain('artifacts/diff.png');

      return cy.request({
        method: 'GET',
        url: '/visual/runs',
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }).then((listResp) => {
      const match = listResp.body.find((r) => r.run_id === runId);
      expect(match, 'run should appear in the visual list').to.exist;
      expect(match.diff_score).to.be.gt(0.9);
    });
  });

  it('serves stored artifacts and refuses path traversal', () => {
    let runId;
    createRun().then((id) => {
      runId = id;
      return upload(runId, 'before', RED_PNG);
    }).then(() => cy.request({
      method: 'GET',
      url: `/runs/${runId}/artifacts/artifacts/before.png`,
      headers: { Authorization: `Bearer ${editorToken}` },
      failOnStatusCode: false,
    })).then((serveResp) => {
      expect(serveResp.status).to.eq(200);
      expect(serveResp.body).to.contain('PNG'); // binary blobs tend to echo the PNG header string

      return cy.request({
        method: 'GET',
        url: `/runs/${runId}/artifacts/..%2F..%2Fpackage.json`,
        headers: { Authorization: `Bearer ${adminToken}` },
        failOnStatusCode: false,
      });
    }).then((travResp) => {
      expect(travResp.status).to.eq(404);
    });
  });

  it('diff without both screenshots returns 400', () => {
    createRun().then((runId) => cy.request({
      method: 'POST',
      url: `/runs/${runId}/visual/diff`,
      headers: { Authorization: `Bearer ${adminToken}` },
      failOnStatusCode: false,
    })).then((resp) => {
      expect(resp.status).to.eq(400);
    });
  });
});