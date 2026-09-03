// =============================================================================
// API tests: /test-cases/:id/versions/*
//
// The version subsystem snapshots a TestCase on every create + every update,
// and exposes:
//   GET    /test-cases/:id/versions
//   GET    /test-cases/:id/versions/:versionId
//   GET    /test-cases/:id/versions/:a/diff/:b
//   POST   /test-cases/:id/versions/:versionId/restore
//
// This spec covers the contract: auth, RBAC (restore is admin/editor),
// snapshot lifecycle, and diff output shape.
// =============================================================================

describe('API: /test-cases/:id/versions/*', () => {
  let admin;
  let editor;
  let viewer;

  before(() => {
    cy.loginAsAdmin().then((a) => {
      admin = a;
      return cy.register({ name: 'Version Editor' });
    }).then((e) => {
      editor = e;
      return cy.register({ name: 'Version Viewer' });
    }).then((v) => {
      viewer = v;
      return cy.setUserRole(admin.token, editor.user.id, 'editor');
    }).then(() => {
      return cy.setUserRole(admin.token, viewer.user.id, 'viewer');
    });
  });

  describe('GET /test-cases/:id/versions', () => {
    it('returns one entry for a freshly created case', () => {
      cy.createTestCase(editor.token, { title: 'Versions: empty' }).then((c) => {
        cy.request({
          url: `/test-cases/${c.id}/versions`,
          headers: { Authorization: `Bearer ${editor.token}` },
        }).then((resp) => {
          expect(resp.status).to.eq(200);
          expect(resp.body).to.be.an('array');
          expect(resp.body).to.have.length(1);
          expect(resp.body[0]).to.include({
            case_id: c.id,
            version: 1,
            created_by_id: editor.user.id,
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('appends a version on every update', () => {
      cy.createTestCase(editor.token, { title: 'Versions: append' }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { description: 'edit 1' },
        });
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { description: 'edit 2' },
        });
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { description: 'edit 3' },
        }).then(() => {
          cy.request({
            url: `/test-cases/${c.id}/versions`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((resp) => {
            expect(resp.body).to.have.length(4);
            // Newest first
            expect(resp.body[0].version).to.eq(4);
            expect(resp.body[3].version).to.eq(1);
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('returns 401 without a token', () => {
      cy.request({
        url: '/test-cases/1/versions',
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(401);
      });
    });

    it('returns 404 for a non-existent case', () => {
      cy.request({
        url: '/test-cases/9999999/versions',
        headers: { Authorization: `Bearer ${editor.token}` },
        failOnStatusCode: false,
      }).then((resp) => {
        expect(resp.status).to.eq(404);
      });
    });
  });

  describe('GET /test-cases/:id/versions/:versionId', () => {
    it('returns the snapshot for that version', () => {
      cy.createTestCase(editor.token, {
        title: 'Versions: snapshot',
        description: 'original',
        steps: ['one', 'two'],
        tags: ['a'],
      }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { description: 'updated', steps: ['one', 'two', 'three'] },
        }).then(() => {
          cy.request({
            url: `/test-cases/${c.id}/versions`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((versionsResp) => {
            const v1 = versionsResp.body.find((v) => v.version === 1);
            const v2 = versionsResp.body.find((v) => v.version === 2);
            expect(v1).to.exist;
            expect(v2).to.exist;

            cy.request({
              url: `/test-cases/${c.id}/versions/${v1.id}`,
              headers: { Authorization: `Bearer ${editor.token}` },
            }).then((resp) => {
              expect(resp.status).to.eq(200);
              expect(resp.body.snapshot.description).to.eq('original');
              expect(resp.body.snapshot.steps).to.deep.eq(['one', 'two']);
              expect(resp.body.snapshot.tags).to.deep.eq(['a']);
            });

            cy.request({
              url: `/test-cases/${c.id}/versions/${v2.id}`,
              headers: { Authorization: `Bearer ${editor.token}` },
            }).then((resp) => {
              expect(resp.body.snapshot.description).to.eq('updated');
              expect(resp.body.snapshot.steps).to.deep.eq(['one', 'two', 'three']);
            });
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });
  });

  describe('GET /test-cases/:id/versions/:a/diff/:b', () => {
    it('returns only the fields that actually changed', () => {
      cy.createTestCase(editor.token, {
        title: 'Diff: title changes',
        description: 'desc',
        steps: ['a', 'b'],
        priority: 'low',
      }).then((c) => {
        // Only title and priority change; description + steps untouched.
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { title: 'Diff: title changes (edited)', priority: 'high' },
        }).then(() => {
          cy.request({
            url: `/test-cases/${c.id}/versions`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((versionsResp) => {
            const v1 = versionsResp.body[1];
            const v2 = versionsResp.body[0];
            cy.request({
              url: `/test-cases/${c.id}/versions/${v1.id}/diff/${v2.id}`,
              headers: { Authorization: `Bearer ${editor.token}` },
            }).then((resp) => {
              expect(resp.status).to.eq(200);
              expect(resp.body.from_version).to.eq(1);
              expect(resp.body.to_version).to.eq(2);
              const fields = resp.body.fields.map((f) => f.field).sort();
              expect(fields).to.deep.eq(['priority', 'title']);
            });
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('marks steps as changed and includes both before and after lines', () => {
      cy.createTestCase(editor.token, {
        title: 'Diff: steps',
        steps: ['open', 'submit', 'verify'],
      }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { steps: ['open', 'submit', 'wait', 'verify'] },
        }).then(() => {
          cy.request({
            url: `/test-cases/${c.id}/versions`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((versionsResp) => {
            const v1 = versionsResp.body[1];
            const v2 = versionsResp.body[0];
            cy.request({
              url: `/test-cases/${c.id}/versions/${v1.id}/diff/${v2.id}`,
              headers: { Authorization: `Bearer ${editor.token}` },
            }).then((resp) => {
              const steps = resp.body.fields.find((f) => f.field === 'steps');
              expect(steps).to.exist;
              expect(steps.kind).to.eq('changed');
              expect(steps.before).to.include.members(['open', 'submit', 'verify']);
              expect(steps.after).to.include('wait');
            });
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('returns 404 if either version does not belong to the case', () => {
      cy.createTestCase(editor.token, { title: 'Diff: 404' }).then((c) => {
        cy.request({
          url: `/test-cases/${c.id}/versions`,
          headers: { Authorization: `Bearer ${editor.token}` },
        }).then((versionsResp) => {
          const v = versionsResp.body[0];
          cy.request({
            url: `/test-cases/${c.id}/versions/${v.id}/diff/9999999`,
            headers: { Authorization: `Bearer ${editor.token}` },
            failOnStatusCode: false,
          }).then((resp) => {
            expect(resp.status).to.eq(404);
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });
  });

  describe('POST /test-cases/:id/versions/:versionId/restore', () => {
    it('reverts the case to an older version and creates a new version', () => {
      cy.createTestCase(editor.token, {
        title: 'Restore: original',
        description: 'v1 desc',
        steps: ['one'],
      }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { title: 'Restore: edited', description: 'v2 desc', steps: ['one', 'two'] },
        }).then(() => {
          cy.request({
            url: `/test-cases/${c.id}/versions`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((versionsResp) => {
            const v1 = versionsResp.body[1];
            const latestBefore = versionsResp.body[0];

            cy.request({
              method: 'POST',
              url: `/test-cases/${c.id}/versions/${v1.id}/restore`,
              headers: { Authorization: `Bearer ${editor.token}` },
            }).then((resp) => {
              expect(resp.status).to.eq(200);
              expect(resp.body.title).to.eq('Restore: original');
              expect(resp.body.description).to.eq('v1 desc');
              expect(resp.body.steps).to.deep.eq(['one']);
            });

            cy.request({
              url: `/test-cases/${c.id}/versions`,
              headers: { Authorization: `Bearer ${editor.token}` },
            }).then((afterResp) => {
              expect(afterResp.body).to.have.length(3);
              expect(afterResp.body[0].version).to.eq(3);
              // The previous-newest version is still in history.
              expect(afterResp.body[1].id).to.eq(latestBefore.id);
            });
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('returns 403 for a viewer', () => {
      cy.createTestCase(editor.token, { title: 'Restore: rbac' }).then((c) => {
        cy.request({
          url: `/test-cases/${c.id}/versions`,
          headers: { Authorization: `Bearer ${editor.token}` },
        }).then((versionsResp) => {
          const v = versionsResp.body[0];
          cy.request({
            method: 'POST',
            url: `/test-cases/${c.id}/versions/${v.id}/restore`,
            headers: { Authorization: `Bearer ${viewer.token}` },
            failOnStatusCode: false,
          }).then((resp) => {
            expect(resp.status).to.eq(403);
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('returns 200 for an admin', () => {
      cy.createTestCase(editor.token, { title: 'Restore: admin' }).then((c) => {
        cy.request({
          method: 'PUT',
          url: `/test-cases/${c.id}`,
          headers: { Authorization: `Bearer ${editor.token}` },
          body: { title: 'Restore: admin (v2)' },
        }).then(() => {
          cy.request({
            url: `/test-cases/${c.id}/versions`,
            headers: { Authorization: `Bearer ${editor.token}` },
          }).then((versionsResp) => {
            const v1 = versionsResp.body[1];
            cy.request({
              method: 'POST',
              url: `/test-cases/${c.id}/versions/${v1.id}/restore`,
              headers: { Authorization: `Bearer ${admin.token}` },
            }).then((resp) => {
              expect(resp.status).to.eq(200);
              expect(resp.body.title).to.eq('Restore: admin');
            });
          });
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });

    it('returns 404 for a non-existent version', () => {
      cy.createTestCase(editor.token, { title: 'Restore: 404' }).then((c) => {
        cy.request({
          method: 'POST',
          url: `/test-cases/${c.id}/versions/9999999/restore`,
          headers: { Authorization: `Bearer ${editor.token}` },
          failOnStatusCode: false,
        }).then((resp) => {
          expect(resp.status).to.eq(404);
        });
        cy.deleteTestCase(editor.token, c.id);
      });
    });
  });

  describe('snapshot hygiene', () => {
    it('soft-deleting a case 404s on its version endpoints', () => {
      cy.createTestCase(editor.token, { title: 'Versions: deleted' }).then((c) => {
        cy.deleteTestCase(editor.token, c.id).then(() => {
          cy.request({
            url: `/test-cases/${c.id}/versions`,
            headers: { Authorization: `Bearer ${editor.token}` },
            failOnStatusCode: false,
          }).then((resp) => {
            expect(resp.status).to.eq(404);
          });
        });
      });
    });
  });
});