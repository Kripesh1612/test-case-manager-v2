// =============================================================================
// API tests: CSRF / Origin allowlist (middleware/csrf.js).
//
// Tier1-PR-8. The CSRF guard was added in batch C (commit e289316) and
// has been protecting every non-safe request since, but the test
// suite never explicitly asserted the rejection contract. These tests
// fail loudly if a refactor of csrfGuard() accidentally accepts a
// foreign-Origin POST — the kind of regression that would otherwise
// only surface in a manual browser test from evil.example.
//
// CSRF_ALLOW_NO_ORIGIN is intentionally unset by default in every
// environment this spec runs against, so a missing-Origin POST falls
// through to the strict rejection path. (Cypress's cy.request does
// not synthesise Origin/Referer — both headers are absent unless we
// set them, which is exactly the case the guard is meant to flag.)
//
// API contract under test:
//   GET/HEAD/OPTIONS ............ always pass (safe verbs)
//   POST/PUT/PATCH/DELETE ........ require Origin or Referer matching
//                                 CSRF_ALLOWED_ORIGINS (or the request's
//                                 own host, by default)
//   CSRF_ALLOW_NO_ORIGIN=1 ...... opt-in escape hatch that allows
//                                 server-to-server callers without an
//                                 Origin header; this spec leaves that
//                                 unset.
// =============================================================================

describe('API: CSRF (Origin allowlist)', () => {
  let editor;

  before(() => {
    return cy.register({ name: 'CSRF Editor' }).then((u) => {
      editor = u;
    });
  });

  describe('rejection cases — should all 403', () => {
    it('POST /test-cases with a foreign Origin is 403', () => {
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: {
          Authorization: `Bearer ${editor.token}`,
          // Same auth, hostile origin — the CSRF guard must catch it.
          Origin: 'http://evil.example',
        },
        body: {
          title: 'csrf-attempt',
          description: '',
          steps: ['step'],
          priority: 'medium',
          result: 'not_run',
        },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(403);
      });
    });

    it('PUT /test-cases/:id with a foreign Origin is 403', () => {
      // We need a real case id to PUT against, otherwise the route's
      // own pre-CSRF middleware would 404 first and we'd see the wrong
      // status. Create one, then attempt the cross-origin PUT.
      cy.createTestCase(editor.token, { title: 'csrf-put-target' }).then((created) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${created.id}`,
          headers: {
            Authorization: `Bearer ${editor.token}`,
            Origin: 'http://evil.example',
          },
          body: { title: 'csrf-mutated' },
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status).to.eq(403);
        }).then(() => cy.deleteTestCase(editor.token, created.id));
      });
    });

    it('DELETE /test-cases/:id with a foreign Origin is 403', () => {
      cy.createTestCase(editor.token, { title: 'csrf-del-target' }).then((created) => {
        cy.request({
          method: 'DELETE',
          url: `/test-cases/${created.id}`,
          headers: {
            Authorization: `Bearer ${editor.token}`,
            Origin: 'http://evil.example',
          },
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status).to.eq(403);
        }).then(() => cy.deleteTestCase(editor.token, created.id));
      });
    });

    it('POST with only a foreign Referer (no Origin) is 403', () => {
      // Some libraries / legacy clients send Referer but strip Origin.
      // The guard accepts Referer as a fallback; the value still has
      // to be in the allowlist.
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: {
          Authorization: `Bearer ${editor.token}`,
          Referer: 'http://evil.example/login',
        },
        body: {
          title: 'csrf-referer-only',
          steps: [],
          priority: 'medium',
          result: 'not_run',
        },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(403);
      });
    });

    it('POST with neither Origin nor Referer is 403 (CSRF_ALLOW_NO_ORIGIN unset)', () => {
      // This is the default-secure behaviour. cy.request does not
      // synthesise either header, so sending a plain request simulates
      // a server-to-server caller that hasn't opted into the
      // CSRF_ALLOW_NO_ORIGIN escape hatch.
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${editor.token}` },
        body: {
          title: 'csrf-no-origin',
          steps: [],
          priority: 'medium',
          result: 'not_run',
        },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(403);
      });
    });
  });

  describe('pass-through cases — must NOT 403', () => {
    // Sanity checks that confirm the guard isn't blanket-rejecting
    // legitimate requests from the same origin. Without these, a
    // misconfigured allowlist that 403'd everything would still pass
    // the negative tests above.

    it('GET is unchanged — safe verbs always pass', () => {
      cy.request({
        url: '/test-cases?limit=10',
        headers: { Authorization: `Bearer ${editor.token}` },
      }).then((resp) => {
        expect(resp.status).to.eq(200);
      });
    });

    it('POST from the request\'s own host (Origin matches) is 200/201', () => {
      // The guard defaults to "the request's own host" when no
      // explicit CSRF_ALLOWED_ORIGINS is set. cy.request hits
      // Cypress's baseUrl (configured in cypress.config.js) which the
      // guard sees as the trusted origin in absence of an override.
      cy.request({
        method: 'POST',
        url: '/test-cases',
        headers: {
          Authorization: `Bearer ${editor.token}`,
          Origin: Cypress.config().baseUrl,
        },
        body: {
          title: 'csrf-same-origin',
          steps: ['do thing'],
          priority: 'medium',
          result: 'not_run',
        },
      }).then((resp) => {
        expect(resp.status).to.be.oneOf([200, 201]);
        cy.deleteTestCase(editor.token, resp.body.id);
      });
    });
  });
});
