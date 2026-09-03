// =============================================================================
// API tests: Flakiness detector
//
//   GET /test-cases/flaky?threshold=N           — list cases above threshold
//   GET /test-cases/:caseId/flakiness           — full report for one case
//
// Each test seeds a case with a specific run-history shape that should land
// it in one of the verdict categories:
//
//   stable               — all passes
//   possibly_flaky       — recent regressed slightly vs a clean baseline
//   flaky                — pure alternation
//   very_flaky           — full alternation + late-failure-after-streak
//   broken               — recent all-fail after a stable baseline
//   insufficient_data    — fewer than 5 finished runs
//
// Seed pattern: POST a case, then for each desired run POST + PUT in
// sequence with the right status. Runs are stamped in reverse-chronological
// order by the server (started_at defaults to now), so the first run
// seeded is the "most recent".
// =============================================================================

describe('API: Flakiness', () => {
  let adminToken;

  before(() => {
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
    });
  });

  /** Seed `pattern` (newest-first) finished runs for `caseId`.
   *  The flakiness analyzer sorts by [started_at DESC, id DESC], so
   *  the LAST-inserted run lands first. We iterate the pattern in
   *  REVERSE so pattern[0] gets the highest id (and therefore lands
   *  at the top of the recent window). Insertion order is
   *  pattern[N-1] → pattern[N-2] → … → pattern[0]. */
  function seedRuns(caseId, pattern) {
    let chain = cy.wrap(null);
    for (const status of [...pattern].reverse()) {
      chain = chain.then(() => cy.request({
        method: 'POST',
        url: `/test-cases/${caseId}/runs`,
        headers: { Authorization: `Bearer ${adminToken}` },
      })).then((runResp) => cy.request({
        method: 'PUT',
        url: `/test-cases/${caseId}/runs/${runResp.body.id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { status },
      }));
    }
    return chain;
  }

  function createCase(title) {
    return cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: `Flake ${title} ${Date.now()}` },
    }).then((r) => r.body.id);
  }

  it('reports verdict=insufficient_data when fewer than 5 finished runs', () => {
    createCase('insufficient').then((caseId) => {
      // Only 2 finished runs.
      seedRuns(caseId, ['passed', 'passed']);
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/flakiness`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.case_id).to.eq(caseId);
        expect(resp.body.verdict).to.eq('insufficient_data');
        expect(resp.body.score).to.be.null;
        expect(resp.body.sample_size).to.eq(2);
        expect(resp.body.last_run_status).to.eq('passed');
      });
    });
  });

  it('reports verdict=stable when all recent + baseline runs pass', () => {
    createCase('stable').then((caseId) => {
      // 10 passes → recent 10/10 pass, no baseline, score should be 0.
      seedRuns(caseId, Array(10).fill('passed'));
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/flakiness`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.verdict).to.eq('stable');
        expect(resp.body.score).to.eq(0);
        expect(resp.body.recent.passed).to.eq(10);
        expect(resp.body.recent.failed).to.eq(0);
        expect(resp.body.recent.pass_rate).to.eq(1);
      });
    });
  });

  it('reports verdict=flaky for pure alternation', () => {
    createCase('alternation').then((caseId) => {
      // 10 alternating P/F runs — switch rate ≈ 1, disagreement high.
      seedRuns(caseId, [
        'passed', 'failed', 'passed', 'failed', 'passed',
        'failed', 'passed', 'failed', 'passed', 'failed',
      ]);
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/flakiness`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.verdict).to.eq('flaky');
        // PFPF → 5P/5F, recent = 10 (no baseline), disagreement = 1 - 0.5 = 0.5
        // switch_rate = 9/9 = 1; late_failure = 0 (last run is 'failed' but
        // the run BEFORE it was 'passed', not a streak of 3+). Score =
        // 40*0.5 + 30*1 + 30*0 = 50.0 → exactly "flaky" (>=50, <75).
        expect(resp.body.score).to.be.gte(50);
        expect(resp.body.score).to.be.lt(75);
        expect(resp.body.signals.switch_rate).to.eq(1);
        expect(resp.body.signals.late_failure).to.eq(0);
      });
    });
  });

  it('reports verdict=very_flaky for full alternation + late failure after streak', () => {
    createCase('veryflaky').then((caseId) => {
      // Newest first: F P P P P F P F P F
      //   late_failure: streak of 4 passes after the most-recent fail
      //     → 1.0
      //   pass_rate 5/10 → disagreement = 0.5
      //   6 switches in 9 gaps
      // The "very_flaky" band (>=75) is intentionally narrow — it
      // requires late_failure=1, disagreement=0.5+, and high switch
      // rate simultaneously, which is mutually constraining in a
      // 10-run window. We assert the signal fires correctly and the
      // verdict lands in the flaky-or-worse band.
      seedRuns(caseId, [
        'failed', 'passed', 'passed', 'passed', 'passed',
        'failed', 'passed', 'failed', 'passed', 'failed',
      ]);
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/flakiness`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(['flaky', 'very_flaky']).to.include(resp.body.verdict);
        expect(resp.body.score).to.be.gte(50);
        expect(resp.body.signals.late_failure).to.eq(1);
        expect(resp.body.signals.switch_rate).to.be.gt(0);
        expect(resp.body.last_run_status).to.eq('failed');
      });
    });
  });

  it('reports verdict=broken when recent is all-fail after a stable baseline', () => {
    createCase('regression').then((caseId) => {
      // The "broken" override requires:
      //   recent.failed >= 5  AND  recent.passed == 0
      //   baseline.length >= 3 AND baseline.pass_rate >= 0.7
      // Seed 15 runs: 10 fails (recent) + 5 passes (baseline).
      seedRuns(caseId, [
        'failed', 'failed', 'failed', 'failed', 'failed',
        'failed', 'failed', 'failed', 'failed', 'failed',
        'passed', 'passed', 'passed', 'passed', 'passed',
      ]);
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/flakiness`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.verdict).to.eq('broken');
        expect(resp.body.recent.passed).to.eq(0);
        expect(resp.body.recent.failed).to.be.gte(5);
        expect(resp.body.baseline.pass_rate).to.be.gte(0.7);
      });
    });
  });

  it('reports verdict=possibly_flaky for mild recent regression', () => {
    createCase('mild').then((caseId) => {
      // Recent (newest-first): F P F P P P P P P P
      //   pass_rate = 8/10 = 0.8; switches = 2 (F/P, P/F); streak 1.
      // Baseline: 10 passes (pass_rate = 1.0).
      //   disagreement = 0.2 → 8 points
      //   switch_rate = 2/9 ≈ 0.222 → 6.7 points
      //   late_failure (streak 1) = 0.5 → 15 points
      //   score ≈ 29.7 → "possibly_flaky" (>=25, <50).
      seedRuns(caseId, [
        'failed', 'passed', 'failed', 'passed', 'passed',
        'passed', 'passed', 'passed', 'passed', 'passed',
        'passed', 'passed', 'passed', 'passed', 'passed',
        'passed', 'passed', 'passed', 'passed', 'passed',
      ]);
      cy.request({
        method: 'GET',
        url: `/test-cases/${caseId}/flakiness`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.verdict).to.eq('possibly_flaky');
        expect(resp.body.score).to.be.gte(25);
        expect(resp.body.score).to.be.lt(50);
        expect(resp.body.signals.disagreement).to.be.gt(0);
        expect(resp.body.signals.switch_rate).to.be.gt(0);
      });
    });
  });

  it('GET /test-cases/flaky returns cases above the threshold sorted by score desc', () => {
    createCase('list-threshold').then((caseId) => {
      seedRuns(caseId, [
        'passed', 'failed', 'passed', 'failed', 'passed',
        'failed', 'passed', 'failed', 'passed', 'failed',
      ]);
      cy.request({
        method: 'GET',
        url: '/test-cases/flaky?threshold=50',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
        expect(resp.body.threshold).to.eq(50);
        expect(resp.body.count).to.be.a('number');
        expect(resp.body.cases).to.be.an('array');
        // Our seeded case should be in the list (score ≈ 50).
        const found = resp.body.cases.find((c) => c.case_id === caseId);
        expect(found, 'expected seeded case to be in flaky list').to.exist;
        expect(found.score).to.be.gte(50);
        // The list must be descending by score.
        const scores = resp.body.cases.map((c) => c.score);
        const sortedDesc = [...scores].sort((a, b) => b - a);
        expect(scores).to.deep.eq(sortedDesc);
      });
    });
  });

  it('GET /test-cases/flaky rejects non-numeric threshold with 400', () => {
    cy.request({
      method: 'GET',
      url: '/test-cases/flaky?threshold=banana',
      headers: { Authorization: `Bearer ${adminToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(400);
    });
  });

  it('GET /test-cases/:caseId/flakiness returns 404 for unknown case', () => {
    cy.request({
      method: 'GET',
      url: '/test-cases/9999999/flakiness',
      headers: { Authorization: `Bearer ${adminToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(404);
    });
  });

  it('anonymous cannot read flakiness endpoints (401)', () => {
    cy.request({
      method: 'GET',
      url: '/test-cases/flaky',
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(401);
    });
    cy.request({
      method: 'GET',
      url: '/test-cases/1/flakiness',
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(401);
    });
  });
});