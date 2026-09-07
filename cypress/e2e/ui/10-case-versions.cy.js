// =============================================================================
// UI tests: /cases/:id — the case detail page with version history + diff view
//
// Page under test: client/src/features/cases/CaseDetailPage.tsx
// data-cy hooks used:
//   - case-detail-page        : <section> wrapper
//   - case-detail-title       : <h2> with the case title
//   - case-detail-status      : status pill
//   - case-detail-priority    : priority pill
//   - case-detail-version-count: "N versions" text
//   - case-edit-btn           : Edit button (top right)
//   - case-version-list       : <aside> sidebar
//   - case-version-row        : <li> per version (data-version, data-version-id, data-selected)
//   - case-version-row-btn    : button to select a version
//   - case-version-restore-btn: Restore button on older versions
//   - case-diff-clear         : "Clear" link when both versions are selected
//   - case-snapshot           : single-snapshot panel
//   - case-diff-field         : one diff field block
//   - case-diff-field-name    : field label
//   - case-diff-added         : an "added" line in a steps diff
//   - case-diff-removed       : a "removed" line in a steps diff
// =============================================================================

describe('UI: /cases/:id case detail + versions', () => {
  let admin;
  before(() => {
    cy.loginAsAdmin().then((a) => {
      admin = a;
    });
  });

  function setupCaseWithTwoVersions() {
    // Helper: create a case, edit it once so it has v1 + v2, then seed
    // the admin token into localStorage so the subsequent `cy.visit()`
    // lands authenticated. Returns the case id, v1 id, and v2 id.
    return cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${admin.token}` },
      body: {
        title: 'Case detail: v1 vs v2',
        description: 'original description',
        steps: ['open', 'submit'],
        priority: 'low',
      },
    }).then((createResp) => {
      const caseId = createResp.body.id;
      return cy.request({
        method: 'PUT',
        url: `/test-cases/${caseId}`,
        headers: { Authorization: `Bearer ${admin.token}` },
        body: {
          description: 'updated description',
          steps: ['open', 'submit', 'verify'],
          priority: 'high',
        },
      }).then(() => {
        return cy.request({
          url: `/test-cases/${caseId}/versions`,
          headers: { Authorization: `Bearer ${admin.token}` },
        }).then((versionsResp) => {
          // Seed localStorage so /auth/me succeeds after cy.visit().
          // setAuthInBrowser visits /login first to be on the same origin.
          return cy.setAuthInBrowser(admin.user, admin.token).then(() => ({
            caseId,
            v1Id: versionsResp.body.find((v) => v.version === 1).id,
            v2Id: versionsResp.body.find((v) => v.version === 2).id,
          }));
        });
      });
    });
  }

  it('renders the case title, status, and version count', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      cy.get('[data-cy="case-detail-page"]').should('be.visible');
      cy.get('[data-cy="case-detail-title"]').should(
        'have.text',
        'Case detail: v1 vs v2',
      );
      cy.get('[data-cy="case-detail-version-count"]').should('contain', '2');
      cy.get('[data-cy="case-detail-status"]').should('be.visible');
      cy.get('[data-cy="case-detail-priority"]').should('be.visible');
    });
  });

  it('shows two versions in the history sidebar, newest first', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      cy.get('[data-cy="case-version-list"] [data-cy="case-version-row"]').should(
        'have.length',
        2,
      );
      cy.get('[data-cy="case-version-row"][data-version="2"]').should(
        'contain',
        'v2',
      );
      cy.get('[data-cy="case-version-row"][data-version="2"]').should(
        'contain',
        'current',
      );
      cy.get('[data-cy="case-version-row"][data-version="1"]').should(
        'not.contain',
        'current',
      );
    });
  });

  it('auto-selects the previous vs current diff on first load', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      cy.get('[data-cy="case-version-row"][data-selected="from"]').should(
        'have.attr',
        'data-version',
        '1',
      );
      cy.get('[data-cy="case-version-row"][data-selected="to"]').should(
        'have.attr',
        'data-version',
        '2',
      );
      cy.get('[data-cy="case-diff-clear"]').should('be.visible');
    });
  });

  it('renders the diff with only the fields that actually changed', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      // description, steps, priority changed; title did NOT.
      cy.get('[data-cy="case-diff-field"]').then(($rows) => {
        const fields = $rows.toArray().map((el) => el.dataset.field).sort();
        expect(fields).to.deep.eq(['description', 'priority', 'steps']);
      });
      cy.get('[data-cy="case-diff-field"][data-field="title"]').should(
        'not.exist',
      );
    });
  });

  it('marks new lines as added in the steps diff', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      cy.get('[data-cy="case-diff-field"][data-field="steps"]').within(() => {
        cy.get('[data-cy="case-diff-added"]').should('contain', 'verify');
      });
    });
  });

  it('clears the diff via the Clear link and falls back to a snapshot of the newest', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      // The auto-load selection shows diff (Clear visible).
      cy.get('[data-cy="case-diff-clear"]').should('be.visible').click();
      // Clear should disappear (we're no longer in diff mode) and the
      // main panel should now show a single-snapshot view.
      cy.get('[data-cy="case-diff-clear"]').should('not.exist');
      cy.get('[data-cy="case-snapshot"]').should('be.visible');
    });
  });

  it('opening /cases/:id?from=<v1Id> directly shows the v1 snapshot (not the diff)', () => {
    setupCaseWithTwoVersions().then(({ caseId, v1Id }) => {
      cy.visit(`/cases/${caseId}?from=${v1Id}`);
      // No `to`, so we should be in single-snapshot mode.
      cy.get('[data-cy="case-diff-clear"]').should('not.exist');
      cy.get('[data-cy="case-snapshot"]').should('be.visible');
      // v1's title was the unmodified "Case detail: v1 vs v2" — and
      // specifically the v1 description was "original description".
      cy.get('[data-cy="case-snapshot"]').should(
        'contain',
        'original description',
      );
      // The passed-from version row should be highlighted as 'from'.
      cy.get(
        `[data-cy="case-version-row"][data-version-id="${v1Id}"][data-selected="from"]`,
      ).should('exist');
    });
  });

  it('shows the Edit button which links back to the list with ?edit=', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      cy.get('[data-cy="case-edit-btn"]')
        .should('have.attr', 'href')
        .and('include', `/cases?edit=${caseId}`);
    });
  });

  it('opens the inline edit modal in place when Edit is clicked (no nav away)', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      cy.url().should('include', `/cases/${caseId}`);
      cy.get('[data-cy="case-edit-btn"]').click();
      // Stay on the detail page and the modal appears.
      cy.url().should('include', `/cases/${caseId}`);
      cy.get('[data-cy="case-edit-modal"]').should('be.visible');
      cy.get('[data-cy="case-form"]').should('be.visible');
      // Cancel closes it without leaving the page.
      cy.get('[data-cy="case-cancel-btn"]').click();
      cy.get('[data-cy="case-edit-modal"]').should('not.exist');
      cy.url().should('include', `/cases/${caseId}`);
    });
  });

  it('cycles the run result from the detail page header', () => {
    setupCaseWithTwoVersions().then(({ caseId }) => {
      cy.visit(`/cases/${caseId}`);
      cy.get('[data-cy="case-detail-run-btn"]')
        .should('have.class', 'result-not_run')
        .click()
        .should('have.class', 'result-passed')
        .click()
        .should('have.class', 'result-failed')
        .click()
        .should('have.class', 'result-not_run');
    });
  });

  it('renders a "not found" panel for a non-existent case id', () => {
    cy.setAuthInBrowser(admin.user, admin.token).then(() => {
      cy.visit('/cases/9999999');
      cy.get('[data-cy="case-detail-page"]').should('not.exist');
      cy.contains('Test case not found').should('be.visible');
    });
  });
});