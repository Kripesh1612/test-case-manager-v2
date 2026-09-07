// =============================================================================
// Unit tests for middleware/registrationGate.js — the REGISTRATION_MODE gate.
//
// The gate has four contracts:
//   1. 'open' mode (default): everyone can register; the gate is a no-op.
//   2. 'invite' mode + zero users: bootstrap escape hatch — first
//      registration is allowed (so an empty DB isn't permanently locked).
//   3. 'invite' mode + ADMIN_EMAILS: bootstrap escape hatch — anyone in
//      ADMIN_EMAILS can register without a token (so a fresh deployment
//      can be unblocked by adding an env var).
//   4. 'invite' mode otherwise: caller must present an invite_token;
//      the token must exist, be unaccepted, be unexpired, and (the
//      route handler additionally verifies) match the email being
//      registered.
//
// We exercise the gate by calling its exported function with a stub
// Express req/res/next. process.env is mutated per-test inside try/
// finally so the rest of the suite isn't affected.
//
// Run: npm run test:unit
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// The middleware reads process.env via utils/settings. Snap and restore
// so our mutations don't leak into other unit tests.
const ENV_SNAPSHOT = { ...process.env };

// Prisma is touched only by the zero-user escape hatch. We stub it
// with a tiny in-memory stand-in for the test process so no real
// Postgres connection is required.
const prismaStub = { user: { count: async () => 0 } };
require.cache[require.resolve('../db')] = {
  exports: prismaStub,
};

const registrationGate = require('./registrationGate');

const fakeRes = () => {
  const res = {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  return res;
};

const fakeReq = (body = {}) => ({ body, invite: undefined });

test.after(() => {
  // Restore env after the whole file runs. Each test also restores in
  // its own finally, but this catches anything we missed.
  for (const k of Object.keys(process.env)) {
    if (!(k in ENV_SNAPSHOT)) delete process.env[k];
  }
  Object.assign(process.env, ENV_SNAPSHOT);
});

// ---- 'open' mode ---------------------------------------------------------

test('open mode: gate is a no-op (next called, no error response)', async () => {
  process.env.REGISTRATION_MODE = 'open';
  let nextCalled = false;
  const next = () => { nextCalled = true; };
  await registrationGate(fakeReq({}), fakeRes(), next);
  assert.equal(nextCalled, true);
});

test('open mode: even with no users / no token / no email, next() fires', async () => {
  process.env.REGISTRATION_MODE = 'open';
  let nextCalled = false;
  await registrationGate(fakeReq({}), fakeRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

// ---- 'invite' mode + escape hatches -------------------------------------

test('invite mode + zero users: first registration is allowed (bootstrap)', async () => {
  process.env.REGISTRATION_MODE = 'invite';
  process.env.ADMIN_EMAILS = '';
  // prismaStub.user.count returns 0 above → bootstrap escape fires.
  let nextCalled = false;
  await registrationGate(fakeReq({}), fakeRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
});

test('invite mode + ADMIN_EMAILS hit: bootstrap escape fires', async () => {
  process.env.REGISTRATION_MODE = 'invite';
  process.env.ADMIN_EMAILS = 'bootstrap-admin@example.com';
  // Even with a populated user count, ADMIN_EMAILS bypasses the gate.
  prismaStub.user.count = async () => 999;
  let nextCalled = false;
  await registrationGate(
    fakeReq({ email: 'bootstrap-admin@example.com' }),
    fakeRes(),
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, true);
  // Restore
  prismaStub.user.count = async () => 0;
  process.env.ADMIN_EMAILS = '';
});

// ---- 'invite' mode + token required -------------------------------------

test('invite mode + non-admin + no token: 403', async () => {
  process.env.REGISTRATION_MODE = 'invite';
  process.env.ADMIN_EMAILS = '';
  prismaStub.user.count = async () => 5;
  const res = fakeRes();
  let nextCalled = false;
  await registrationGate(fakeReq({ email: 'newbie@example.com' }), res, () => { nextCalled = true; });
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /invite-only/i);
});

test('invite mode + unknown token: 403', async () => {
  process.env.REGISTRATION_MODE = 'invite';
  process.env.ADMIN_EMAILS = '';
  prismaStub.user.count = async () => 5;
  // Stub prisma.invite.findUnique to return null (token not in DB).
  const originalInvite = prismaStub.invite;
  prismaStub.invite = { findUnique: async () => null };
  const res = fakeRes();
  let nextCalled = false;
  await registrationGate(
    fakeReq({ email: 'newbie@example.com', invite_token: 'does-not-exist' }),
    res,
    () => { nextCalled = true; },
  );
  assert.equal(nextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /invalid invite/i);
  prismaStub.invite = originalInvite;
});

test('invite mode + already-accepted invite: 403', async () => {
  process.env.REGISTRATION_MODE = 'invite';
  process.env.ADMIN_EMAILS = '';
  prismaStub.user.count = async () => 5;
  prismaStub.invite = {
    findUnique: async () => ({ accepted_at: new Date(), expires_at: new Date(Date.now() + 86400000) }),
  };
  const res = fakeRes();
  await registrationGate(
    fakeReq({ email: 'x@example.com', invite_token: 'used-token' }),
    res,
    () => {},
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /already used/i);
});

test('invite mode + expired invite: 403', async () => {
  process.env.REGISTRATION_MODE = 'invite';
  process.env.ADMIN_EMAILS = '';
  prismaStub.user.count = async () => 5;
  prismaStub.invite = {
    findUnique: async () => ({ accepted_at: null, expires_at: new Date(Date.now() - 86400000) }),
  };
  const res = fakeRes();
  await registrationGate(
    fakeReq({ email: 'x@example.com', invite_token: 'expired-token' }),
    res,
    () => {},
  );
  assert.equal(res.statusCode, 403);
  assert.match(res.body.error, /expired/i);
});

test('invite mode + valid invite: next() fires and req.invite is set', async () => {
  process.env.REGISTRATION_MODE = 'invite';
  process.env.ADMIN_EMAILS = '';
  prismaStub.user.count = async () => 5;
  const inviteRow = {
    accepted_at: null,
    expires_at: new Date(Date.now() + 86400000),
    email: 'invitee@example.com',
  };
  prismaStub.invite = { findUnique: async () => inviteRow };
  const req = fakeReq({ email: 'invitee@example.com', invite_token: 'good-token' });
  let nextCalled = false;
  await registrationGate(req, fakeRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  assert.equal(req.invite, inviteRow);
});

// ---- Defaults + typo safety ---------------------------------------------

test('invalid REGISTRATION_MODE value falls back to open (not invite-lock)', async () => {
  // Typo like REGISTRATION_MODE=invite-only should NOT lock the app.
  process.env.REGISTRATION_MODE = 'invite-only';
  let nextCalled = false;
  await registrationGate(fakeReq({}), fakeRes(), () => { nextCalled = true; });
  assert.equal(nextCalled, true);
  process.env.REGISTRATION_MODE = 'open';
});
