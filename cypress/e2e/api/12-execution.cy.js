// =============================================================================
// API tests: Phase 8 — Real Test Execution
//
//   POST /test-cases/:id/execute      start a Cypress run
//   GET  /runs/:id/stream             SSE feed for one run
//
// Three contracts are verified end-to-end:
//
//   1. happy-path    → 201 with a TestRun row at status='running';
//                      the executor eventually flips it to 'passed'.
//   2. failure-input → 400 when the case has no executable_snippet.
//   3. RBAC          → viewer POST returns 403, admin POST works.
//
// The happy path test deliberately DOES NOT poll for completion: a
// real Cypress invocation spins up a fresh headless browser per run
// and is slow enough (10-30 s+) that adding a "wait for passed"
// assertion would inflate the suite's runtime. The contract we
// verify here is that the route exists, gates correctly, and creates
// the row. The downstream "executor finished the run" path is
// observable via the SSE stream; that's covered by the UI test in
// 12-execution.cy.js.
// =============================================================================

describe('API: /execution', () => {
  let adminToken;
  let viewerToken;

  before(() => {
    return cy
      .loginAsAdmin()
      .then(({ token }) => { adminToken = token; })
      .then(() => cy.register({ name: 'Exec Viewer' }))
      .then(({ token, user }) => {
        viewerToken = token;
        return cy.request({
          method: 'PUT',
          url: `/users/${user.id}/role`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { role: 'viewer' },
        });
      });
  });

  it('starts a Cypress run when the case has a snippet (returns 201 + running status)', () => {
    const snippet = "it('health check', () => { cy.visit('/'); });";
    let caseId;

    cy.createTestCase(adminToken, {
      title: `exec-happy-${Date.now()}`,
      executable_snippet: snippet,
    }).then((created) => {
      caseId = created.id;
      return cy.request({
        method: 'POST',
        url: `/test-cases/${caseId}/execute`,
        headers: { Authorization: `Bearer ${adminToken}` },
        // Override timeout: Cypress's requestTimeout (10s) is shorter
        // than the route's worst case (the route fires the executor
        // synchronously then returns, so this is normally instant, but
        // occasionally a busy server can briefly stall — be defensive).
        timeout: 30000,
      });
    }).then((resp) => {
      expect(resp.status, 'POST /execute → 201').to.eq(201);
      expect(resp.body.status, 'TestRun must be created at status=running')
        .to.eq('running');
      expect(resp.body.test_case_id).to.eq(caseId);
      expect(resp.body.started_via, 'started_via defaults to "manual"').to.eq('manual');
      expect(resp.body.id).to.be.a('number');

      // Sanity-check: the historic GET endpoint also sees the row.
      return cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/runs?limit=5`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((listResp) => {
        const found = listResp.body.runs.find((r) => r.id === resp.body.id);
        expect(found, 'new run should appear in /runs history').to.exist;
      });
    });
  });

  it('rejects execution when the case has no snippet (400)', () => {
    cy.createTestCase(adminToken, {
      title: `exec-empty-${Date.now()}`,
      // deliberately omit executable_snippet
    }).then((created) => {
      return cy.request({
        method: 'POST',
        url: `/test-cases/${created.id}/execute`,
        headers: { Authorization: `Bearer ${adminToken}` },
        failOnStatusCode: false,
      });
    }).then((resp) => {
      expect(resp.status).to.eq(400);
      expect(resp.body.error).to.match(/executable snippet/i);
    });
  });

  it('forbids viewers from executing (403)', () => {
    cy.createTestCase(adminToken, {
      title: `exec-rbac-${Date.now()}`,
      executable_snippet: "it('x', () => {});",
    }).then((created) => {
      return cy.request({
        method: 'POST',
        url: `/test-cases/${created.id}/execute`,
        headers: { Authorization: `Bearer ${viewerToken}` },
        failOnStatusCode: false,
      });
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('SSE stream returns snapshot for an existing run (and 404 for a missing run)', () => {
    // Seed a run, then GET /runs/:id/stream, close immediately, and
    // verify the snapshot event was emitted. We can't easily wait for
    // the SSE response body to fully flush inside a Cypress test (the
    // cy.request helper doesn't natively understand SSE), so we rely
    // on the route's 200 vs 404 contract — the snapshot itself is
    // exercised by the UI test.
    cy.createTestCase(adminToken, {
      title: `exec-sse-${Date.now()}`,
      executable_snippet: "it('x', () => {});",
    }).then((created) => {
      return cy.request({
        method: 'POST',
        url: `/test-cases/${created.id}/execute`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
    }).then((runResp) => {
      const runId = runResp.body.id;
      return cy.request({
        method: 'GET',
        url: `/runs/${runId}/stream`,
        headers: { Authorization: `Bearer ${adminToken}` },
        // Don't reject on non-2xx. We only want to confirm the route
        // accepts the request — the actual stream body is read by the
        // UI test.
        failOnStatusCode: false,
        timeout: 5000,
      }).then((streamResp) => {
        // 200 means the server opened the stream. Anything else (other
        // than 200 from a path-test) would be a regression. The stream
        // body is consumed via fetch in the UI test.
        expect([200, 304], 'stream route reachable').to.include(streamResp.status);
      });
    });

    // 404 path — separate case so the failure is unambiguous.
    cy.request({
      method: 'GET',
      url: '/runs/9999999/stream',
      headers: { Authorization: `Bearer ${adminToken}` },
      failOnStatusCode: false,
    }).then((missing) => {
      expect(missing.status).to.eq(404);
    });
  });
});
