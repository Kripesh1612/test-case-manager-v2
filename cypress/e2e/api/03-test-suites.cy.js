// =============================================================================
// API tests: /test-suites/*
// =============================================================================
describe('API: /test-suites/*', () => {
  let editor;

  before(() => {
    return cy.register({ name: 'Suites Editor' }).then((u) => {
      editor = u;
    });
  });

  describe('POST /test-suites', () => {
    let cases;
    let suite;

    beforeEach(() => {
      // Build 3 fresh cases, then capture them in scope for this test only.
      return cy.createTestCase(editor.token, { title: 'A' })
        .then((a) => cy.createTestCase(editor.token, { title: 'B' }).then((b) => ({ a, b })))
        .then(({ a, b }) =>
          cy.createTestCase(editor.token, { title: 'C' }).then((c) => {
            cases = [a, b, c];
          })
        );
    });

    afterEach(() => {
      if (suite) cy.deleteTestSuite(editor.token, suite.id);
      if (cases) cases.forEach((c) => cy.deleteTestCase(editor.token, c.id));
      suite = null;
      cases = null;
    });

    it('creates a suite and stores test_case_ids', () => {
      cy.createTestSuite(editor.token, {
        name: 'Smoke',
        test_case_ids: [cases[0].id, cases[1].id],
      }).then((s) => {
        suite = s;
        expect(s).to.have.property('id');
        expect(s.test_case_ids).to.have.members([cases[0].id, cases[1].id]);
      });
    });
  });

  describe('POST /test-suites/:id/run', () => {
    let cases;
    let suite;

    beforeEach(() => {
      return cy.createTestCase(editor.token, { title: 'A' })
        .then((a) => cy.createTestCase(editor.token, { title: 'B' }).then((b) => ({ a, b })))
        .then(({ a, b }) =>
          cy.createTestCase(editor.token, { title: 'C' }).then((c) => {
            cases = [a, b, c];
          })
        );
    });

    afterEach(() => {
      if (suite) cy.deleteTestSuite(editor.token, suite.id);
      if (cases) cases.forEach((c) => cy.deleteTestCase(editor.token, c.id));
      suite = null;
      cases = null;
    });

    it('marks every member case as passed and stamps last_run_at', () => {
      cy.createTestSuite(editor.token, {
        name: 'Run me',
        test_case_ids: cases.map((c) => c.id),
      }).then((s) => {
        suite = s;
        cy.request({
          method: 'POST',
          url: `/test-suites/${s.id}/run`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { result: 'passed' },
        }).then((resp) => {
          expect(resp.status).to.eq(200);
          expect(resp.body.updated).to.eq(cases.length);
        });

        // Every member should now show result=passed
        cases.forEach((c) => {
          cy.request({
            url: `/test-cases/${c.id}`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((resp) => {
            expect(resp.body.result).to.eq('passed');
            expect(resp.body.last_run_at).to.not.be.null;
          });
        });
      });
    });

    it('rejects invalid result value with 400', () => {
      cy.createTestSuite(editor.token, { name: 'Bad run' }).then((s) => {
        suite = s;
        cy.request({
          method: 'POST',
          url: `/test-suites/${s.id}/run`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { result: 'maybe' },
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status).to.eq(400);
        });
      });
    });
  });
});
