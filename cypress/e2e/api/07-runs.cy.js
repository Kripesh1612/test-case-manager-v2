// =============================================================================
// API tests: Test Runs
//
// POST /test-cases/:id/runs   start a run
// PUT  /test-cases/:id/runs/:runId   finish it
// GET  /test-cases/:id/runs   history for one case
// GET  /runs/recent            dashboard feed (last N days)
//
// Also verifies that PUT /test-cases/:id { result: "passed" } (legacy
// shortcut) creates a TestRun row, and that POST /test-suites/:id/run
// creates one per member case.
// =============================================================================

describe('API: /runs', () => {
  let adminToken;
  let adminId;
  let editorToken;
  let viewerToken;

  before(() => {
    return cy.loginAsAdmin().then(({ token, user }) => {
      adminToken = token;
      adminId = user.id;
      return cy.register({ name: 'Runs Editor' });
    }).then(({ token }) => {
      editorToken = token;
      return cy.register({ name: 'Runs Viewer' });
    }).then(({ token, user }) => {
      viewerToken = token;
      return cy.request({
        method: 'PUT',
        url: `/users/${user.id}/role`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { role: 'viewer' },
      });
    });
  });

  it('POST /test-cases/:id/runs starts a run', () => {
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Runs start ${Date.now()}` },
    }).then((resp) => {
      const caseId = resp.body.id;
      cy.request({
        method: 'POST',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((runResp) => {
        expect(runResp.status).to.eq(201);
        expect(runResp.body).to.include({
          test_case_id: caseId,
          status: 'not_run',
          run_by_id: adminId, // captured from loginAsAdmin() above
        });
        expect(runResp.body.id).to.be.a('number');
        expect(runResp.body.started_at).to.be.a('string');
      });
    });
  });

  it('PUT /test-cases/:id/runs/:runId finishes a run', () => {
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Runs finish ${Date.now()}` },
    }).then((resp) => {
      const caseId = resp.body.id;
      cy.request({
        method: 'POST',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((runResp) => {
        const runId = runResp.body.id;
        cy.request({
          method: 'PUT',
          url: `/test-cases/${caseId}/runs/${runId}`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { status: 'passed', notes: 'all green' },
        }).then((putResp) => {
          expect(putResp.status).to.eq(200);
          expect(putResp.body.status).to.eq('passed');
          expect(putResp.body.notes).to.eq('all green');
          expect(putResp.body.finished_at).to.not.be.null;
          expect(putResp.body.duration_ms).to.be.a('number');
        });
      });
    });
  });

  it('GET /test-cases/:id/runs returns the history for one case', () => {
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Runs history ${Date.now()}` },
    }).then((resp) => {
      const caseId = resp.body.id;
      cy.request({
        method: 'POST',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((r1) => {
        cy.request({
          method: 'POST',
          url: `/test-cases/${caseId}/runs`,
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then(() => {
          cy.request({
            method: 'PUT',
            url: `/test-cases/${caseId}/runs/${r1.body.id}`,
            headers: { Authorization: `Bearer ${adminToken}` },
            body: { status: 'failed' },
          }).then(() => {
            cy.request({
              method: 'GET',
              url: `/test-cases/${caseId}/runs`,
              headers: { Authorization: `Bearer ${adminToken}` },
            }).then((listResp) => {
              expect(listResp.body.runs.length).to.be.at.least(2);
              const finished = listResp.body.runs.find((r) => r.status === 'failed');
              expect(finished, 'expected a failed run').to.exist;
            });
          });
        });
      });
    });
  });

  it('GET /runs/recent returns runs from the last N days', () => {
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Runs recent ${Date.now()}` },
    }).then((resp) => {
      const caseId = resp.body.id;
      cy.request({
        method: 'POST',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      cy.request({
        method: 'GET',
        url: '/runs/recent?days=7',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((recentResp) => {
        expect(recentResp.status).to.eq(200);
        expect(recentResp.body.days).to.eq(7);
        expect(recentResp.body.runs).to.be.an('array');
        expect(recentResp.body.runs.length).to.be.at.least(1);
        // Each run includes test_case and run_by details.
        const run = recentResp.body.runs[0];
        expect(run.test_case).to.be.an('object');
        expect(run.run_by).to.be.an('object');
      });
    });
  });

  it('PUT /test-cases/:id with result="passed" creates a TestRun row', () => {
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Runs shortcut ${Date.now()}` },
    }).then((resp) => {
      const caseId = resp.body.id;
      cy.request({
        method: 'PUT',
        url: `/test-cases/${caseId}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { result: 'passed' },
      });
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((listResp) => {
        const found = listResp.body.runs.find((r) => r.status === 'passed');
        expect(found, 'expected a passed TestRun after shortcut').to.exist;
      });
    });
  });

  it('POST /test-suites/:id/run creates one TestRun per member case', () => {
    const stamp = Date.now();
    let suiteId;
    let caseId1;
    let caseId2;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Suite run ${stamp} A` },
    }).then((r1) => {
      caseId1 = r1.body.id;
      return cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { title: `Suite run ${stamp} B` },
      });
    }).then((r2) => {
      caseId2 = r2.body.id;
      return cy.request({
        method: 'POST',
        url: '/test-suites',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: `Suite run ${stamp}`, test_case_ids: [caseId1, caseId2] },
      });
    }).then((s) => {
      suiteId = s.body.id;
      return cy.request({
        method: 'POST',
        url: `/test-suites/${suiteId}/run`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { result: 'passed' },
      });
    }).then(() => {
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId1}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((r1) => {
        const found = r1.body.runs.find((r) => r.status === 'passed');
        expect(found, 'expected a passed TestRun for case 1').to.exist;
      });
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId2}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((r2) => {
        const found = r2.body.runs.find((r) => r.status === 'passed');
        expect(found, 'expected a passed TestRun for case 2').to.exist;
      });
    });
  });

  it('viewer can GET /test-cases/:id/runs but cannot POST', () => {
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Runs rbac viewer ${Date.now()}` },
    }).then((resp) => {
      const caseId = resp.body.id;
      // GET is allowed.
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${viewerToken}` },
      }).then((getResp) => {
        expect(getResp.status).to.eq(200);
      });
      // POST is denied.
      cy.request({
        method: 'POST',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${viewerToken}` },
        failOnStatusCode: false,
      }).then((postResp) => {
        expect(postResp.status).to.eq(403);
      });
    });
  });

  it('editor can start a run', () => {
    let editorId;
    cy.request({
      method: 'GET',
      url: '/users',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).then((usersResp) => {
      // Pick the MOST RECENT editor named "Runs Editor" (the one we just
      // created in before()) — earlier runs of this spec have older
      // editors with the same name.
      const matches = usersResp.body.filter((u) => u.name === 'Runs Editor');
      expect(matches.length).to.be.at.least(1);
      editorId = matches[matches.length - 1].id;
    }).then(() => {
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { title: `Runs editor ${Date.now()}` },
      }).then((resp) => {
        const caseId = resp.body.id;
        cy.request({
          method: 'POST',
          url: `/test-cases/${caseId}/runs`,
          headers: { Authorization: `Bearer ${editorToken}` },
        }).then((runResp) => {
          expect(runResp.status).to.eq(201);
          expect(runResp.body.run_by_id).to.eq(editorId);
        });
      });
    });
  });

  it('PUT with invalid status returns 400', () => {
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Runs bad status ${Date.now()}` },
    }).then((resp) => {
      const caseId = resp.body.id;
      cy.request({
        method: 'POST',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((runResp) => {
        const runId = runResp.body.id;
        cy.request({
          method: 'PUT',
          url: `/test-cases/${caseId}/runs/${runId}`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { status: 'maybe' },
          failOnStatusCode: false,
        }).then((putResp) => {
          expect(putResp.status).to.eq(400);
        });
      });
    });
  });

  it('anonymous cannot POST a run (401)', () => {
    cy.request({
      method: 'POST',
      url: '/test-cases/1/runs',
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(401);
    });
  });
});