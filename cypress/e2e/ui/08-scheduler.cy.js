// =============================================================================
// UI E2E: /scheduler — admin creates, runs, and deletes a scheduled job
// =============================================================================
describe('UI: Scheduler page', () => {
  let suiteId;
  let caseIds = [];
  let createdJobIds = [];

  before(() => {
    // Chain everything so we don't fire createTestCase before the auth
    // token has been persisted to localStorage.
    return cy.loginAsAdmin().then(({ user, token }) =>
      cy.setAuthInBrowser(user, token)
    ).then(() =>
      cy.createTestCase(window.localStorage.getItem('tcm_token'), { title: 'ui-sched-1' })
    ).then((a) =>
      cy.createTestCase(window.localStorage.getItem('tcm_token'), { title: 'ui-sched-2' }).then((b) => {
        caseIds = [a.id, b.id];
        return cy.createTestSuite(window.localStorage.getItem('tcm_token'), {
          name: 'ui-scheduler-suite',
          test_case_ids: caseIds,
        });
      })
    ).then((suite) => {
      suiteId = suite.id;
    });
  });

  beforeEach(() => {
    cy.visit('/scheduler');
  });

  afterEach(() => {
    const tok = window.localStorage.getItem('tcm_token');
    createdJobIds.forEach((id) => {
      cy.request({
        method: 'DELETE',
        url: `/scheduled-jobs/${id}`,
        headers: { Authorization: `Bearer ${tok}` },
        failOnStatusCode: false,
      });
    });
    createdJobIds = [];
  });

  it('renders the scheduler page with tabs and empty state', () => {
    cy.get('[data-cy="tab-scheduler"]').should('be.visible').and('have.class', 'active');
    cy.get('[data-cy="job-list"]').should('be.visible');
    // The new-job button is admin-only and should be visible for us.
    cy.get('[data-cy="job-new-btn"]').should('be.visible');
  });

  it('opens the create form, validates cron, and creates a job', () => {
    cy.get('[data-cy="job-new-btn"]').click();
    cy.get('[data-cy="job-form"]').should('be.visible');

    // Bad cron shows error preview
    cy.get('[data-cy="job-cron-input"]').type('not a cron');
    cy.get('[data-cy="job-form-preview"]').should('be.visible').and('contain', 'Not a valid');

    // Clear and type a good cron; preview shows the humanized form.
    cy.get('[data-cy="job-cron-input"]').clear().type('0 9 * * 1-5');
    cy.get('[data-cy="job-form-preview"]').should('contain', 'Weekdays');

    // Fill name + pick suite, submit
    cy.get('[data-cy="job-name-input"]').type('UI weekday smoke');
    cy.get('[data-cy="job-suite-select"]').select(String(suiteId));
    cy.get('[data-cy="job-submit-btn"]').click();

    // Form closes, job appears in the list
    cy.get('[data-cy="job-form"]').should('not.be.visible');
    cy.contains('[data-cy="job-row"]', 'UI weekday smoke').should('be.visible');
    cy.contains('[data-cy="job-row"]', 'UI weekday smoke').within(() => {
      cy.get('[data-cy="job-cron"]').should('contain', '0 9 * * 1-5');
      cy.get('[data-cy="job-status-enabled"]').should('exist');
    });

    // Capture the job id for cleanup.
    cy.contains('[data-cy="job-row"]', 'UI weekday smoke').invoke('attr', 'data-job-id').then((id) => {
      createdJobIds.push(parseInt(id, 10));
    });
  });

  it('runs a job immediately and surfaces a success toast', () => {
    // Seed a job via the API.
    cy.request({
      method: 'POST',
      url: '/scheduled-jobs',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
      body: { name: 'UI run-now', cron: '0 9 * * *', suite_id: suiteId },
    }).then((resp) => {
      createdJobIds.push(resp.body.id);
      cy.reload();

      cy.contains('[data-cy="job-row"]', 'UI run-now').within(() => {
        cy.get('[data-cy="job-run-btn"]').click();
      });
      cy.get('[data-cy="toast"]').should('contain', 'Ran "UI run-now"');
    });
  });

  it('opens the history modal', () => {
    cy.request({
      method: 'POST',
      url: '/scheduled-jobs',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
      body: { name: 'UI history', cron: '0 9 * * *', suite_id: suiteId },
    }).then((resp) => {
      createdJobIds.push(resp.body.id);
      // Fire once so history has at least one event.
      cy.request({
        method: 'POST',
        url: `/scheduled-jobs/${resp.body.id}/run`,
        headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
      });
    }).then(() => {
      cy.reload();
      cy.contains('[data-cy="job-row"]', 'UI history').within(() => {
        cy.get('[data-cy="job-history-btn"]').click();
      });
      cy.get('[data-cy="history-modal"]').should('be.visible');
      cy.get('[data-cy="history-table"]').should('exist');
      cy.get('[data-cy="history-close-btn"]').click();
      cy.get('[data-cy="history-modal"]').should('not.exist');
    });
  });

  it('disables and re-enables a job', () => {
    cy.request({
      method: 'POST',
      url: '/scheduled-jobs',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
      body: { name: 'UI toggle', cron: '0 9 * * *', suite_id: suiteId },
    }).then((resp) => {
      createdJobIds.push(resp.body.id);
      cy.reload();

      cy.contains('[data-cy="job-row"]', 'UI toggle').within(() => {
        // Toggle off
        cy.get('[data-cy="job-toggle-btn"]').click();
        cy.get('[data-cy="job-status-disabled"]').should('exist');
        cy.get('[data-cy="job-toggle-btn"]').should('contain', 'Enable');
      }).then(() => cy.reload())
        .then(() => {
          // The state should persist across reloads.
          cy.contains('[data-cy="job-row"]', 'UI toggle').within(() => {
            cy.get('[data-cy="job-status-disabled"]').should('exist');
            cy.get('[data-cy="job-toggle-btn"]').click();
            cy.get('[data-cy="job-status-enabled"]').should('exist');
          });
        });
    });
  });

  it('deletes a job via confirm modal', () => {
    cy.request({
      method: 'POST',
      url: '/scheduled-jobs',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
      body: { name: 'UI delete', cron: '0 9 * * *', suite_id: suiteId },
    }).then((resp) => {
      // Don't add to createdJobIds — we'll delete it through the UI.
      const id = resp.body.id;
      cy.reload();

      cy.contains('[data-cy="job-row"]', 'UI delete').within(() => {
        cy.get('[data-cy="job-delete-btn"]').click();
      });
      cy.get('[data-cy="modal-confirm"]').click();
      cy.contains('[data-cy="job-row"]', 'UI delete').should('not.exist');
    });
  });

  it('hides admin-only buttons when the user is a viewer', () => {
    // Self-sufficient: seed our own job so the assertion doesn't depend on
    // leftover state from prior specs / tests (otherwise the list can be
    // empty when this test runs in isolation, e.g. after the delete test
    // wiped its row).
    cy.request({
      method: 'POST',
      url: '/scheduled-jobs',
      headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
      body: { name: 'UI viewer-hide', cron: '0 9 * * *', suite_id: suiteId },
    }).then((resp) => {
      createdJobIds.push(resp.body.id);
    }).then(() =>
      cy.register({ name: 'Viewer for Sched UI' }).then((viewer) => {
        // Demote to viewer.
        cy.request({
          method: 'GET',
          url: '/users',
          headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
        }).then((usersResp) => {
          const u = usersResp.body.find((x) => x.email === viewer.email);
          cy.request({
            method: 'PUT',
            url: `/users/${u.id}/role`,
            headers: { Authorization: `Bearer ${window.localStorage.getItem('tcm_token')}` },
            body: { role: 'viewer' },
          });
          cy.setAuthInBrowser({ ...viewer.user, role: 'viewer' }, viewer.token);
          cy.visit('/scheduler');

          cy.get('[data-cy="job-new-btn"]').should('not.be.visible');
          // But history should still be visible to viewers.
          cy.get('[data-cy="job-history-btn"]').first().should('be.visible');
        });
      })
    );
  });
});
