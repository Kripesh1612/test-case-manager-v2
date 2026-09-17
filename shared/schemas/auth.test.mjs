// Audit C (validation): verify the schema tightening actually rejects
// what we want it to reject and accepts what we want it to accept.
//
// Written as ESM so `node --test` can resolve the .js schemas from the
// same source-of-truth used by the React client. The CommonJS routes
// import the same schemas via Node 22's require(esm).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerSchema,
  loginSchema,
  inviteCreateSchema,
} from './auth.js';

test('registerSchema accepts normal email + 8-char password with letter+digit', () => {
  const r = registerSchema.safeParse({
    email: 'Alice@Example.com',
    password: 'hunter2hunter',
    name: 'Alice',
  });
  assert.equal(r.success, true);
  // Email gets canonicalized to lowercase + trimmed.
  assert.equal(r.data.email, 'alice@example.com');
});

test('registerSchema lowercases and trims email', () => {
  const r = registerSchema.safeParse({
    email: '   Bob@X.COM  ',
    password: 'abcd1234',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.email, 'bob@x.com');
});

test('registerSchema rejects password without a digit', () => {
  const r = registerSchema.safeParse({
    email: 'a@b.com',
    password: 'onlyletters',
  });
  assert.equal(r.success, false);
  assert.match(r.error.issues[0].message, /letter/);
});

test('registerSchema rejects password without a letter', () => {
  const r = registerSchema.safeParse({
    email: 'a@b.com',
    password: '12345678',
  });
  assert.equal(r.success, false);
});

test('registerSchema rejects too-short password', () => {
  const r = registerSchema.safeParse({
    email: 'a@b.com',
    password: 'a1b',
  });
  assert.equal(r.success, false);
});

test('registerSchema rejects password > 100 chars', () => {
  const r = registerSchema.safeParse({
    email: 'a@b.com',
    password: 'a1' + 'x'.repeat(99),
  });
  assert.equal(r.success, false);
});

test('registerSchema rejects malformed email', () => {
  const r = registerSchema.safeParse({
    email: 'not-an-email',
    password: 'goodpass1',
  });
  assert.equal(r.success, false);
});

test('registerSchema rejects email over RFC 5321 mailbox limit', () => {
  const localPart = 'a'.repeat(250);
  const r = registerSchema.safeParse({
    email: `${localPart}@x.com`,
    password: 'goodpass1',
  });
  assert.equal(r.success, false);
});

test('loginSchema canonicalizes email but leaves password alone', () => {
  const r = loginSchema.safeParse({
    email: 'Alice@X.com',
    password: 'whatever',
  });
  assert.equal(r.success, true);
  assert.equal(r.data.email, 'alice@x.com');
  assert.equal(r.data.password, 'whatever');
});

test('loginSchema rejects empty password', () => {
  const r = loginSchema.safeParse({ email: 'a@b.com', password: '' });
  assert.equal(r.success, false);
});

test('loginSchema rejects missing email', () => {
  const r = loginSchema.safeParse({ password: 'x' });
  assert.equal(r.success, false);
});

test('inviteCreateSchema accepts a valid payload', () => {
  const r = inviteCreateSchema.safeParse({
    email: 'invitee@x.com',
    role: 'editor',
    project_id: 7,
  });
  assert.equal(r.success, true);
});

test('inviteCreateSchema rejects unknown role', () => {
  const r = inviteCreateSchema.safeParse({
    email: 'invitee@x.com',
    role: 'superuser',
  });
  assert.equal(r.success, false);
});

test('inviteCreateSchema rejects non-positive project_id', () => {
  const r = inviteCreateSchema.safeParse({
    email: 'invitee@x.com',
    project_id: -1,
  });
  assert.equal(r.success, false);
});
