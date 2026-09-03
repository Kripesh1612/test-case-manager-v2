// =============================================================================
// API tests: /invites
//
// Endpoints:
//   POST   /invites        admin — create
//   GET    /invites        admin — list (with ?status=pending|accepted|expired)
//   DELETE /invites/:id    admin — revoke
//   POST   /invites/redeem public — { token, name, password }
//
// Most of the suite runs with REGISTRATION_MODE=open (the default — the
// learning-friendly mode) so the invite endpoints are exercised directly
// via /invites/redeem. The invite-mode gate on /auth/register is covered
// by a separate test that flips REGISTRATION_MODE at runtime via the
// /auth/mode debug endpoint (or by hitting a route that observes it).
// =============================================================================

describe('API: /invites', () => {
  let adminToken;
  let editorToken;

  before(() => {
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
      return cy.register({ name: 'Invites Editor' });
    }).then(({ token }) => {
      editorToken = token;
    });
  });

  it('admin can create an invite', () => {
    const email = `invite-create-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email, role: 'editor' },
    }).then((resp) => {
      expect(resp.status).to.eq(201);
      expect(resp.body.email).to.eq(email);
      expect(resp.body.role).to.eq('editor');
      expect(resp.body.token).to.be.a('string');
      expect(resp.body.token.length).to.be.at.least(32);
      expect(resp.body.accept_url).to.include('/invite-redeem?token=');
      expect(resp.body.expires_at).to.be.a('string');
    });
  });

  it('admin can list invites and the new one is there', () => {
    const email = `invite-list-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email },
    }).then(() => {
      cy.request({
        method: 'GET',
        url: '/invites',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((listResp) => {
        expect(listResp.status).to.eq(200);
        expect(listResp.body.invites).to.be.an('array');
        const found = listResp.body.invites.find((i) => i.email === email);
        expect(found, `expected to find invite for ${email}`).to.exist;
        expect(found.accepted_at).to.be.null;
      });
    });
  });

  it('non-admin cannot create an invite (403)', () => {
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${editorToken}` },
      body: { email: `invite-forbidden-${Date.now()}@example.com` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('non-admin cannot list invites (403)', () => {
    cy.request({
      method: 'GET',
      url: '/invites',
      headers: { Authorization: `Bearer ${editorToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(403);
    });
  });

  it('anonymous cannot list or create invites (401)', () => {
    cy.request({
      method: 'GET',
      url: '/invites',
      failOnStatusCode: false,
    }).then((getResp) => {
      expect(getResp.status).to.eq(401);
    });
    cy.request({
      method: 'POST',
      url: '/invites',
      body: { email: 'anon@example.com' },
      failOnStatusCode: false,
    }).then((postResp) => {
      expect(postResp.status).to.eq(401);
    });
  });

  it('create invite with bad role returns 400', () => {
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email: 'badrole@example.com', role: 'superuser' },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(400);
    });
  });

  it('create invite without email returns 400', () => {
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { role: 'viewer' },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(400);
    });
  });

  it('redeem creates a new user, returns a JWT, and stamps accepted_at', () => {
    const email = `invite-redeem-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email, role: 'editor' },
    }).then((createResp) => {
      const token = createResp.body.token;
      const inviteId = createResp.body.id;
      cy.request({
        method: 'POST',
        url: '/invites/redeem',
        body: { token, name: 'Redeemed User', password: 'password123' },
      }).then((redeemResp) => {
        expect(redeemResp.status).to.eq(201);
        expect(redeemResp.body.user.email).to.eq(email);
        expect(redeemResp.body.user.role).to.eq('editor');
        expect(redeemResp.body.token).to.be.a('string');

        // accepted_at is now set.
        cy.request({
          method: 'GET',
          url: '/invites',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then((listResp) => {
          const row = listResp.body.invites.find((i) => i.id === inviteId);
          expect(row.accepted_at, 'expected accepted_at after redeem').to.not.be.null;
        });
      });
    });
  });

  it('redeeming an already-accepted invite returns 410', () => {
    const email = `invite-replay-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email },
    }).then((createResp) => {
      const token = createResp.body.token;
      cy.request({
        method: 'POST',
        url: '/invites/redeem',
        body: { token, name: 'First Try', password: 'password123' },
      });
      cy.request({
        method: 'POST',
        url: '/invites/redeem',
        body: { token, name: 'Second Try', password: 'password123' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(410);
      });
    });
  });

  it('redeem with a bogus token returns 404', () => {
    cy.request({
      method: 'POST',
      url: '/invites/redeem',
      body: { token: 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff', name: 'X', password: 'password123' },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(404);
    });
  });

  it('redeem with missing fields returns 400', () => {
    cy.request({
      method: 'POST',
      url: '/invites/redeem',
      body: { token: 'whatever' },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(400);
    });
  });

  it('admin can revoke an invite (204) and the token then fails to redeem', () => {
    const email = `invite-revoke-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email },
    }).then((createResp) => {
      const id = createResp.body.id;
      const token = createResp.body.token;
      cy.request({
        method: 'DELETE',
        url: `/invites/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((delResp) => {
        expect(delResp.status).to.eq(204);
      });
      // The token no longer exists → redeem returns 404.
      cy.request({
        method: 'POST',
        url: '/invites/redeem',
        body: { token, name: 'After Revoke', password: 'password123' },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(404);
      });
    });
  });

  it('non-admin cannot revoke an invite (403)', () => {
    const email = `invite-revoke-rbac-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email },
    }).then((createResp) => {
      cy.request({
        method: 'DELETE',
        url: `/invites/${createResp.body.id}`,
        headers: { Authorization: `Bearer ${editorToken}` },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(403);
      });
    });
  });

  it('revoking a non-existent invite returns 404', () => {
    cy.request({
      method: 'DELETE',
      url: '/invites/99999999',
      headers: { Authorization: `Bearer ${adminToken}` },
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(404);
    });
  });

  it('list ?status=pending excludes accepted invites', () => {
    const acceptedEmail = `invite-filter-acc-${Date.now()}@example.com`;
    const pendingEmail = `invite-filter-pend-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email: acceptedEmail },
    }).then((r1) => {
      cy.request({
        method: 'POST',
        url: '/invites/redeem',
        body: { token: r1.body.token, name: 'Filtered', password: 'password123' },
      });
      cy.request({
        method: 'POST',
        url: '/invites',
        headers: { Authorization: `Bearer ${adminToken}` },
        body: { email: pendingEmail },
      }).then(() => {
        cy.request({
          method: 'GET',
          url: '/invites?status=pending',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then((pendingResp) => {
          const emails = pendingResp.body.invites.map((i) => i.email);
          expect(emails).to.include(pendingEmail);
          expect(emails).to.not.include(acceptedEmail);
        });
        cy.request({
          method: 'GET',
          url: '/invites?status=accepted',
          headers: { Authorization: `Bearer ${adminToken}` },
        }).then((accResp) => {
          const emails = accResp.body.invites.map((i) => i.email);
          expect(emails).to.include(acceptedEmail);
        });
      });
    });
  });

  it('redeem endpoint is reachable without auth (public)', () => {
    // Confirms /invites/redeem does NOT sit behind requireAuth — that's
    // the whole point of the redeem page.
    const email = `invite-public-${Date.now()}@example.com`;
    cy.request({
      method: 'POST',
      url: '/invites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { email },
    }).then((createResp) => {
      // No Authorization header at all.
      cy.request({
        method: 'POST',
        url: '/invites/redeem',
        body: { token: createResp.body.token, name: 'Public', password: 'password123' },
      }).then((resp) => {
        expect(resp.status).to.eq(201);
      });
    });
  });
});
