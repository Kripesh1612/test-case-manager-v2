// =============================================================================
// UI E2E: Flakiness
//
//   /cases  → list page shows a FlakinessBadge per row (only when interesting)
//   /cases/:id → detail page mounts the FlakinessPanel
//   /dashboard → FlakyCasesCard renders the top-N list with verdict pills
//
// Each test seeds a known pattern via the API so the assertion is
// deterministic regardless of what other cases exist in the DB.
// =============================================================================

describe('UI: Flakiness', () => {
  let admin;
  let adminToken;
  let stableCaseId;
  let flakyCaseId;

  before(() => {
    return cy.loginAsAdmin().then(({ user, token }) => {
      admin = user;
      adminToken = token;
      return cy.setAuthInBrowser(user, token);
    }).then(() => {
      // Seed a stable case (10 passes) and a flaky case (alternation).
      return cy.createTestCase(adminToken, { title: `UI flake stable ${Date.now()}` });
    }).then((stableCase) => {
      stableCaseId = stableCase.id;
      return seedRuns(stableCaseId, Array(10).fill('passed'));
    }).then(() => {
      return cy.createTestCase(adminToken, { title: `UI flake alternating ${Date.now()}` });
    }).then((flakyCase) => {
      flakyCaseId = flakyCase.id;
      return seedRuns(flakyCaseId, [
        'passed', 'failed', 'passed', 'failed', 'passed',
        'failed', 'passed', 'failed', 'passed', 'failed',
      ]);
    });
  });

  function seedRuns(caseId, pattern) {
    // Analyzer sorts [started_at DESC, id DESC], so insert in reverse
    // to put pattern[0] at the top of the recent window.
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

  beforeEach(() => {
    cy.window().then((win) => {
      if (!win.localStorage.getItem('tcm_token')) {
        cy.setAuthInBrowser(admin, adminToken);
      }
    });
  });

  it('case list shows the FlakinessBadge for the flaky case but hides it for stable', () => {
    cy.visit('/cases');
    cy.get('[data-cy="case-list"]').should('be.visible');

    // The flaky case should show a badge with verdict='flaky' or higher.
    cy.get(`[data-cy="case-row"][data-case-id="${flakyCaseId}"]`).within(() => {
      cy.get('[data-cy^="flakiness-badge-"]').should('exist').and(($el) => {
        const verdict = $el.attr('data-verdict');
        expect(['flaky', 'very_flaky']).to.include(verdict);
      });
    });

    // The stable case has onlyWhenInteresting=true so its badge is hidden.
    cy.get(`[data-cy="case-row"][data-case-id="${stableCaseId}"]`)
      .find('[data-cy^="flakiness-badge-"]')
      .should('not.exist');
  });

  it('case detail page renders the FlakinessPanel with score + verdict', () => {
    cy.visit(`/cases/${flakyCaseId}`);
    cy.get('[data-cy="flakiness-panel"]').should('be.visible');
    cy.get('[data-cy="flakiness-report"]').should('be.visible');
    cy.get('[data-cy="flakiness-verdict"]').should(($el) => {
      const verdict = $el.attr('data-verdict');
      expect(['flaky', 'very_flaky']).to.include(verdict);
    });
    cy.get('[data-cy="flakiness-score"]').should('contain', '/');
    cy.get('[data-cy="flakiness-sample-size"]').invoke('text').then((t) => {
      const m = t.match(/(\d+)/);
      expect(m, 'sample size should include a number').to.not.be.null;
      expect(Number(m[1])).to.be.gte(10);
    });
  });

  it('dashboard renders the FlakyCasesCard with the list endpoint data', () => {
    // The dashboard card shows the top-N most-flaky cases. Our seeded
    // case may or may not make the top 10 depending on whatever else
    // exists in the DB. So we assert that the card renders with a
    // numeric count and some rows (the top 10 are guaranteed to
    // appear when the DB has >=10 cases above the default score).
    cy.visit('/dashboard');
    cy.get('[data-cy="flaky-cases-card"]').should('be.visible');
    // The count badge polls from "–" (placeholder while loading) to a
    // number once /test-cases/flaky resolves. On a large DB the
    // endpoint scores every case sequentially so the wait can run
    // 30+ s. Use a long polling timeout; `should()` retries until the
    // text transitions out of the placeholder.
    cy.get('[data-cy="flaky-cases-count"]', { timeout: 90000 })
      .invoke('text')
      .invoke('trim')
      .should((t) => {
        expect(t, 'badge must transition out of placeholder').to.not.equal('–');
        const n = Number(t);
        expect(Number.isFinite(n), `expected numeric count, got "${t}"`).to.be.true;
        expect(n).to.be.at.least(0);
      });
    // Top 10 rows should be rendered with verdict pills.
    cy.get('[data-cy="flaky-case-row"]').its('length').should('be.gte', 1);
    cy.get('[data-cy="flaky-case-row"]').first().within(() => {
      cy.get('[data-cy="flaky-case-link"]').invoke('text').invoke('trim').then((text) => {
        expect(text, 'flaky-case link should have non-empty title').to.not.be.empty;
      });
      cy.root().invoke('attr', 'data-verdict').then((v) => {
        expect(v).to.match(/flaky|very_flaky|broken/);
      });
    });
  });

  it('"View all flaky" link navigates to /cases?verdict=flaky with banner', () => {
    cy.visit('/dashboard');
    // Wait for the card's data to load (count goes from "–" to a number)
    // before clicking — otherwise the verdict filter on the next page
    // sees an empty subset. Long timeout for the same reason as above.
    cy.get('[data-cy="flaky-cases-card"]').should('be.visible');
    cy.get('[data-cy="flaky-cases-count"]', { timeout: 90000 })
      .invoke('text')
      .invoke('trim')
      .should((t) => {
        expect(t, 'badge must transition out of placeholder').to.not.equal('–');
      });
    // The flaky section has its own per-section "View all" link.
    cy.get('[data-cy="flaky-section-view-all"]').should('be.visible').click();
    cy.url().should('include', '/cases');
    cy.url().should('include', 'verdict=flaky');
    // The case list shows the orange "Showing flaky tests" banner.
    cy.get('[data-cy="verdict-filter-banner"]').should('be.visible');
    cy.get('[data-cy="verdict-filter-banner"]').invoke('attr', 'data-verdict').then((v) => {
      expect(v).to.equal('flaky');
    });
    // Banner copy mentions "flaky tests" (not "regressions").
    cy.get('[data-cy="verdict-filter-banner"]').should('contain', 'flaky tests');
    // Clear button removes the filter and the banner disappears.
    cy.get('[data-cy="verdict-filter-clear"]').click();
    cy.url().should('not.include', 'verdict=flaky');
    cy.get('[data-cy="verdict-filter-banner"]').should('not.exist');
  });

  it('"View all regressions" link navigates to /cases?verdict=broken with banner', () => {
    cy.visit('/dashboard');
    cy.get('[data-cy="flaky-cases-card"]').should('be.visible');
    cy.get('[data-cy="flaky-cases-count"]', { timeout: 90000 })
      .invoke('text')
      .invoke('trim')
      .should((t) => {
        expect(t, 'badge must transition out of placeholder').to.not.equal('–');
      });
    // The regressions sub-section only renders its "View all" when at
    // least one regression case exists. If none do, skip the
    // navigation check — the link simply isn't there.
    cy.get('body').then(($body) => {
      if ($body.find('[data-cy="regressions-view-all"]').length === 0) {
        cy.log('no regressions seeded — skipping link nav');
        return;
      }
      cy.get('[data-cy="regressions-view-all"]').should('be.visible').click();
      cy.url().should('include', '/cases');
      cy.url().should('include', 'verdict=broken');
      cy.get('[data-cy="verdict-filter-banner"]').should('be.visible');
      cy.get('[data-cy="verdict-filter-banner"]').invoke('attr', 'data-verdict').then((v) => {
        expect(v).to.equal('broken');
      });
      cy.get('[data-cy="verdict-filter-banner"]').should('contain', 'regressions');
      cy.get('[data-cy="verdict-filter-clear"]').click();
      cy.url().should('not.include', 'verdict=broken');
      cy.get('[data-cy="verdict-filter-banner"]').should('not.exist');
    });
  });
});