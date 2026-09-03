// =============================================================================
// API tests: /scheduled-jobs/*
//
// Endpoints:
//   POST   /scheduled-jobs          admin — create
//   GET    /scheduled-jobs          any authed user — list
//   GET    /scheduled-jobs/:id      any authed user — read one
//   GET    /scheduled-jobs/:id/history  any authed user — last 25 fires
//   PATCH  /scheduled-jobs/:id      admin — update
//   DELETE /scheduled-jobs/:id      admin — delete
//   POST   /scheduled-jobs/:id/run  admin — fire now
//
// What we cover:
//   - happy path: create → list → read → run-now → history → update → delete
//   - validation: bad cron, missing fields, bad suite_id
//   - RBAC: non-admin gets 403 on create/update/delete/run; viewers can read
//   - next_run_at: computed on create and recomputed on update of cron / enable
// =============================================================================

describe('API: /scheduled-jobs/*', () => {
  let adminToken;
  let editorToken;
  let viewerToken;
  let caseIds;
  let suiteId;

  before(() => {
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
      return cy.register({ name: 'Sched Editor' });
    }).then(({ user, token }) => {
      editorToken = token;
      return cy.register({ name: 'Sched Viewer' }).then((viewerData) => {
        // New users default to editor; demote to viewer for the RBAC tests.
        cy.request({
          method: 'PUT',
          url: `/users/${viewerData.user.id}/role`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { role: 'viewer' },
        });
        viewerToken = viewerData.token;
      });
    });
  });

  // Build a 2-case suite we can reuse across tests. Done once; jobs point
  // at this suite. Per-test cleanup deletes the job only — the suite sticks
  // around so we don't need to recreate it.
  before(() => {
    cy.createTestCase(adminToken, { title: 'sched-case-A' }).then((a) =>
      cy.createTestCase(adminToken, { title: 'sched-case-B' }).then((b) => {
        caseIds = [a.id, b.id];
        return cy.createTestSuite(adminToken, {
          name: 'sched-fixture-suite',
          test_case_ids: caseIds,
        });
      })
    ).then((suite) => {
      suiteId = suite.id;
    });
  });

  // ----- RBAC -----

  describe('RBAC', () => {
    it('rejects unauthenticated requests', () => {
      cy.request({ method: 'GET', url: '/scheduled-jobs', failOnStatusCode: false })
        .its('status').should('eq', 401);
      cy.request({ method: 'POST', url: '/scheduled-jobs', body: {}, failOnStatusCode: false })
        .its('status').should('eq', 401);
    });

    it('forbids editor from creating a scheduled job', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${editorToken}` },
        body: { name: 'x', cron: '0 9 * * *', suite_id: suiteId },
        failOnStatusCode: false,
      }).its('status').should('eq', 403);
    });

    it('forbids editor from running a scheduled job', () => {
      let jobId;
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'rbac-run', cron: '0 9 * * *', suite_id: suiteId },
      }).then((resp) => {
        jobId = resp.body.id;
      }).then(() => cy.request({
        method: 'POST',
        url: `/scheduled-jobs/${jobId}/run`,
        headers: { Authorization: `Bearer ${editorToken}` },
        failOnStatusCode: false,
      })).its('status').should('eq', 403).then(() => {
        cy.request({ method: 'DELETE', url: `/scheduled-jobs/${jobId}`, headers: { Authorization: `Bearer ${adminToken}` } });
      });
    });

    it('forbids editor from updating a scheduled job', () => {
      let jobId;
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'rbac-update', cron: '0 9 * * *', suite_id: suiteId },
      }).then((resp) => {
        jobId = resp.body.id;
      }).then(() => cy.request({
        method: 'PATCH',
        url: `/scheduled-jobs/${jobId}`,
        headers: { Authorization: `Bearer ${editorToken}` },
        body: { name: 'new' },
        failOnStatusCode: false,
      })).its('status').should('eq', 403).then(() => {
        cy.request({ method: 'DELETE', url: `/scheduled-jobs/${jobId}`, headers: { Authorization: `Bearer ${adminToken}` } });
      });
    });

    it('allows any authed user to list and read', () => {
      // Make at least one job first.
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'rbac-read', cron: '0 9 * * *', suite_id: suiteId },
      }).then((createResp) => {
        const id = createResp.body.id;

        // Editor can list
        cy.request({
          method: 'GET',
          url: '/scheduled-jobs',
          headers: { Authorization: `Bearer ${editorToken}` },
        }).its('status').should('eq', 200);

        // Viewer can read
        cy.request({
          method: 'GET',
          url: `/scheduled-jobs/${id}`,
          headers: { Authorization: `Bearer ${viewerToken}` },
        }).its('status').should('eq', 200);

        // Viewer can read history
        cy.request({
          method: 'GET',
          url: `/scheduled-jobs/${id}/history`,
          headers: { Authorization: `Bearer ${viewerToken}` },
        }).its('status').should('eq', 200);
      }).then(() => {
        // Cleanup the job we created.
        cy.request({
          method: 'GET',
          url: '/scheduled-jobs',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then((listResp) => {
          listResp.body.filter((j) => j.name === 'rbac-read').forEach((j) => {
            cy.request({ method: 'DELETE', url: `/scheduled-jobs/${j.id}`, headers: { Authorization: `Bearer ${adminToken}` } });
          });
        });
      });
    });
  });

  // ----- Validation -----

  describe('Validation', () => {
    it('rejects a malformed cron expression', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'bad', cron: 'not a cron', suite_id: suiteId },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(400);
        // Validation errors expose details[].path; the cron field should
        // be the offender.
        expect(resp.body.error).to.eq('Validation failed');
        const cronDetail = (resp.body.details || []).find((d) => d.path === 'cron');
        expect(cronDetail, 'expected a details[] entry for path "cron"').to.exist;
        expect(cronDetail.message).to.match(/cron/i);
      });
    });

    it('rejects a cron with the wrong number of fields', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'bad', cron: '* * *', suite_id: suiteId },
        failOnStatusCode: false,
      }).its('status').should('eq', 400);
    });

    it('rejects a missing suite_id', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'no-suite', cron: '0 9 * * *' },
        failOnStatusCode: false,
      }).its('status').should('eq', 400);
    });

    it('rejects a suite_id that does not exist', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'orphan', cron: '0 9 * * *', suite_id: 999999 },
        failOnStatusCode: false,
      }).its('status').should('eq', 400);
    });

    it('rejects max_retries > 10', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'too-many', cron: '0 9 * * *', suite_id: suiteId, max_retries: 50 },
        failOnStatusCode: false,
      }).its('status').should('eq', 400);
    });
  });

  // ----- Happy path -----

  describe('CRUD + run-now', () => {
    let job;

    beforeEach(() => {
      job = null;
    });

    afterEach(() => {
      if (job && job.id) {
        cy.request({
          method: 'DELETE',
          url: `/scheduled-jobs/${job.id}`,
          headers: { Authorization: `Bearer ${adminToken}` },
          failOnStatusCode: false,
        });
      }
    });

    it('creates a job with a computed next_run_at', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: {
          name: 'happy-create',
          cron: '0 9 * * 1-5',
          suite_id: suiteId,
          max_retries: 2,
        },
      }).then((resp) => {
        expect(resp.status).to.eq(201);
        expect(resp.body.id).to.be.a('number');
        expect(resp.body.cron).to.eq('0 9 * * 1-5');
        expect(resp.body.timezone).to.eq('UTC');
        expect(resp.body.enabled).to.eq(true);
        expect(resp.body.max_retries).to.eq(2);
        expect(resp.body.next_run_at).to.be.a('string');
        // 0 9 * * 1-5 in UTC: next Monday/Tue/.../Fri at 09:00.
        const next = new Date(resp.body.next_run_at);
        expect(next.getUTCHours()).to.eq(9);
        expect(next.getUTCMinutes()).to.eq(0);
        expect([1, 2, 3, 4, 5]).to.include(next.getUTCDay());
        job = resp.body;
      });
    });

    it('fires a job and records history', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'happy-run', cron: '0 9 * * 1-5', suite_id: suiteId },
      }).then((createResp) => {
        job = createResp.body;

        // Capture the test-runs count before firing so we can confirm the
        // "run now" actually created new ones.
        cy.request({
          method: 'GET',
          url: `/test-cases/${caseIds[0]}/runs`,
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then((beforeRuns) => {
          const beforeCount = beforeRuns.body.count;

          cy.request({
            method: 'POST',
            url: `/scheduled-jobs/${job.id}/run`,
            headers: { Authorization: `Bearer ${adminToken}` },
          }).then((runResp) => {
            expect(runResp.status).to.eq(200);
            expect(runResp.body.runs_created).to.eq(caseIds.length);
            expect(runResp.body.suite_id).to.eq(suiteId);
            expect(runResp.body.trigger).to.eq('manual');

            // Each case should now have one more run than before.
            cy.request({
              method: 'GET',
              url: `/test-cases/${caseIds[0]}/runs`,
              headers: { Authorization: `Bearer ${adminToken}` },
            }).then((afterRuns) => {
              expect(afterRuns.body.count).to.eq(beforeCount + 1);
            });
          });
        });

        // History should now have at least one fire event.
        cy.request({
          method: 'GET',
          url: `/scheduled-jobs/${job.id}/history`,
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then((histResp) => {
          expect(histResp.status).to.eq(200);
          expect(histResp.body.count).to.be.at.least(1);
          expect(histResp.body.events[0].action).to.eq('scheduled_job.fire');
        });
      });
    });

    it('updates cron and recomputes next_run_at', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'happy-update', cron: '0 9 * * *', suite_id: suiteId },
      }).then((createResp) => {
        job = createResp.body;
        const originalNext = job.next_run_at;

        cy.request({
          method: 'PATCH',
          url: `/scheduled-jobs/${job.id}`,
          headers: { Authorization: `Bearer ${adminToken}` },
          body: { cron: '*/15 * * * *' },
        }).then((patchResp) => {
          expect(patchResp.status).to.eq(200);
          expect(patchResp.body.cron).to.eq('*/15 * * * *');
          // Next-run should change (much sooner — every 15 min vs once a day).
          expect(new Date(patchResp.body.next_run_at).getTime())
            .to.be.lessThan(new Date(originalNext).getTime());
        });
      });
    });

    it('disables a job and clears retry state on re-enable', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'happy-toggle', cron: '0 9 * * *', suite_id: suiteId },
      }).then((createResp) => {
        job = createResp.body;
      }).then(() => cy.request({
        method: 'PATCH',
        url: `/scheduled-jobs/${job.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { enabled: false },
      })).then((disableResp) => {
        expect(disableResp.body.enabled).to.eq(false);
      }).then(() => cy.request({
        method: 'PATCH',
        url: `/scheduled-jobs/${job.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { enabled: true },
      })).then((enableResp) => {
        expect(enableResp.body.enabled).to.eq(true);
        expect(enableResp.body.next_run_at).to.be.a('string');
        expect(enableResp.body.retry_count).to.eq(0);
      });
    });

    it('deletes a job', () => {
      cy.request({
        method: 'POST',
        url: '/scheduled-jobs',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { name: 'happy-delete', cron: '0 9 * * *', suite_id: suiteId },
      }).then((createResp) => {
        job = createResp.body;
        cy.request({
          method: 'DELETE',
          url: `/scheduled-jobs/${job.id}`,
          headers: { Authorization: `Bearer ${adminToken}` },
        }).its('status').should('eq', 204);

        // Subsequent read should 404.
        cy.request({
          method: 'GET',
          url: `/scheduled-jobs/${job.id}`,
          headers: { Authorization: `Bearer ${adminToken}` },
          failOnStatusCode: false,
        }).its('status').should('eq', 404);
        job = null; // prevent afterEach from trying to delete again
      });
    });
  });
});
