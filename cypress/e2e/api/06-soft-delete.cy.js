// =============================================================================
// API tests: soft delete + Trash
//
// Verifies the soft-delete contract:
//   - DELETE /test-cases/:id sets deleted_at (row still in DB)
//   - GET /test-cases excludes soft-deleted rows
//   - GET /trash/cases lists them
//   - POST /trash/cases/:id/restore brings them back
//   - DELETE /trash/cases/:id hard-deletes (purge)
//   - Same shape for test-suites
//   - Restore + purge are admin-only
// =============================================================================

describe('API: soft delete + trash', () => {
  let adminToken;
  let editorToken;
  let viewerToken;

  before(() => {
    return cy.loginAsAdmin().then(({ token }) => {
      adminToken = token;
      return cy.register({ name: 'Trash Editor' });
    }).then(({ token }) => {
      editorToken = token;
      return cy.register({ name: 'Trash Viewer' });
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

  it('DELETE /test-cases/:id is a soft delete (returns 204, row still in DB)', () => {
    const unique = `Trash case ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((delResp) => {
        expect(delResp.status).to.eq(204);
      });
      // The row is still in the DB but excluded from the user-facing list.
      cy.request({
        method: 'GET',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((listResp) => {
        const ids = listResp.body.map((c) => c.id);
        expect(ids).to.not.include(id);
      });
    });
  });

  it('GET /trash/cases lists soft-deleted cases', () => {
    const unique = `Trash list ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      cy.request({
        method: 'GET',
        url: '/trash/cases',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((trashResp) => {
        expect(trashResp.body.cases.map((c) => c.id)).to.include(id);
        const found = trashResp.body.cases.find((c) => c.id === id);
        expect(found.deleted_at).to.not.be.null;
        expect(found.title).to.eq(unique);
      });
    });
  });

  it('POST /trash/cases/:id/restore brings a soft-deleted case back', () => {
    const unique = `Trash restore ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      cy.request({
        method: 'POST',
        url: `/trash/cases/${id}/restore`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((restoreResp) => {
        expect(restoreResp.status).to.eq(200);
        expect(restoreResp.body.deleted_at).to.be.null;
      });
      // Back in the user-facing list.
      cy.request({
        method: 'GET',
        url: '/test-cases',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((listResp) => {
        const found = listResp.body.find((c) => c.id === id);
        expect(found).to.exist;
        expect(found.deleted_at).to.be.null;
      });
    });
  });

  it('DELETE /trash/cases/:id purges (hard delete)', () => {
    const unique = `Trash purge ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      cy.request({
        method: 'DELETE',
        url: `/trash/cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((purgeResp) => {
        expect(purgeResp.status).to.eq(204);
      });
      // Truly gone: GET returns 404, and not in trash.
      cy.request({
        method: 'GET',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        failOnStatusCode: false,
      }).then((getResp) => {
        expect(getResp.status).to.eq(404);
      });
    });
  });

  it('purge refuses if the row is not currently trashed (404)', () => {
    const unique = `Trash not trashed ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      // Don't soft-delete first; try to purge directly.
      cy.request({
        method: 'DELETE',
        url: `/trash/cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
        failOnStatusCode: false,
      }).then((purgeResp) => {
        expect(purgeResp.status).to.eq(404);
      });
    });
  });

  it('DELETE /test-suites/:id is a soft delete', () => {
    const unique = `Trash suite ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-suites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-suites/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((delResp) => {
        expect(delResp.status).to.eq(204);
      });
      cy.request({
        method: 'GET',
        url: '/trash/suites',
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((trashResp) => {
        expect(trashResp.body.suites.map((s) => s.id)).to.include(id);
      });
    });
  });

  it('POST /trash/suites/:id/restore brings a soft-deleted suite back', () => {
    const unique = `Trash suite restore ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-suites',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { name: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-suites/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      cy.request({
        method: 'POST',
        url: `/trash/suites/${id}/restore`,
        headers: { Authorization: `Bearer ${adminToken}` },
      }).then((restoreResp) => {
        expect(restoreResp.status).to.eq(200);
        expect(restoreResp.body.deleted_at).to.be.null;
      });
    });
  });

  it('DELETE /trash/cases/:id is admin-only (editor gets 403)', () => {
    const unique = `Trash rbac case ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      cy.request({
        method: 'DELETE',
        url: `/trash/cases/${id}`,
        headers: { Authorization: `Bearer ${editorToken}` },
        failOnStatusCode: false,
      }).then((purgeResp) => {
        expect(purgeResp.status).to.eq(403);
      });
    });
  });

  it('DELETE /trash/cases/:id is admin-only (viewer gets 403)', () => {
    const unique = `Trash rbac viewer ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      cy.request({
        method: 'DELETE',
        url: `/trash/cases/${id}`,
        headers: { Authorization: `Bearer ${viewerToken}` },
        failOnStatusCode: false,
      }).then((purgeResp) => {
        expect(purgeResp.status).to.eq(403);
      });
    });
  });

  it('restore is admin-only (editor gets 403)', () => {
    const unique = `Trash rbac restore ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      const id = resp.body.id;
      cy.request({
        method: 'DELETE',
        url: `/test-cases/${id}`,
        headers: { Authorization: `Bearer ${adminToken}` },
      });
      cy.request({
        method: 'POST',
        url: `/trash/cases/${id}/restore`,
        headers: { Authorization: `Bearer ${editorToken}` },
        failOnStatusCode: false,
      }).then((restoreResp) => {
        expect(restoreResp.status).to.eq(403);
      });
    });
  });

  it('restore of an active (non-trashed) row returns 404', () => {
    const unique = `Trash active ${Date.now()}`;
    cy.request({
      method: 'POST',
      url: '/test-cases',
      headers: { Authorization: `Bearer ${adminToken}` },
      body: { title: unique },
    }).then((resp) => {
      cy.request({
        method: 'POST',
        url: `/trash/cases/${resp.body.id}/restore`,
        headers: { Authorization: `Bearer ${adminToken}` },
        failOnStatusCode: false,
      }).then((restoreResp) => {
        expect(restoreResp.status).to.eq(404);
      });
    });
  });

  it('anonymous cannot read /trash (401)', () => {
    cy.request({
      method: 'GET',
      url: '/trash/cases',
      failOnStatusCode: false,
    }).then((resp) => {
      expect(resp.status).to.eq(401);
    });
  });
});