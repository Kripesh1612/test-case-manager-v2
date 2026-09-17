// =============================================================================
// Unit tests for utils/webhookSecret.js + the SSRF guards in utils/webhooks.js.
//
// Run: npm run test:unit
//
// Coverage map (Batch A audit fixes):
//   - encryptSecret: empty/null round-trip to empty
//   - encryptSecret: same plaintext → different ciphertext (IV uniqueness)
//   - decryptSecret: round-trips correctly
//   - decryptSecret: leaves plaintext unchanged (migration fallback)
//   - decryptSecret: corrupted/tampered ciphertext → '' (no wrong signature)
//   - structurallySafeUrl: rejects file://, gopher://, ftp://, javascript:
//   - structurallySafeUrl: rejects RFC1918 IPv4 literals (10.x, 192.168.x,
//     172.16-31.x, 127.x, 169.254.x)
//   - structurallySafeUrl: rejects IPv6 loopback, link-local, ULA
//   - structurallySafeUrl: accepts https://example.com
//   - assertUrlSafeAtDelivery: refuses localhost at DNS time
//   - assertUrlSafeAtDelivery: resolves a public-looking name (mocked)
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns').promises;

const { encryptSecret, decryptSecret } = require('./webhookSecret');
const { structurallySafeUrl, assertUrlSafeAtDelivery } = require('./webhooks');

// ---- encryptSecret / decryptSecret ----------------------------------------

test('encryptSecret: empty string round-trips to empty', () => {
  assert.equal(encryptSecret(''), '');
  assert.equal(encryptSecret(null), '');
  assert.equal(encryptSecret(undefined), '');
});

test('encryptSecret: produces different ciphertext for the same plaintext (random IV)', () => {
  const a = encryptSecret('super-secret');
  const b = encryptSecret('super-secret');
  assert.notEqual(a, b);
  assert.match(a, /^enc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
});

test('decryptSecret: round-trips ciphertext', () => {
  const ct = encryptSecret('hello world');
  assert.equal(decryptSecret(ct), 'hello world');
});

test('decryptSecret: plaintext input passes through (migration fallback)', () => {
  // Rows encrypted before this fix landed still hold plaintext. The
  // decrypt path accepts that so the app keeps working during the
  // rotation window. Don't expose this fallback to user input.
  assert.equal(decryptSecret('plain-secret'), 'plain-secret');
});

test('decryptSecret: empty input → empty output', () => {
  assert.equal(decryptSecret(''), '');
  assert.equal(decryptSecret(null), '');
  assert.equal(decryptSecret(undefined), '');
});

test('decryptSecret: tampered ciphertext returns empty (not garbage)', () => {
  const ct = encryptSecret('hello');
  // Flip a byte in the ciphertext portion.
  const parts = ct.split(':');
  const ct_b64 = parts[4];
  const flipped = ct_b64.slice(0, -2) + (ct_b64.slice(-2) === 'AA' ? 'BB' : 'AA');
  const tampered = `${parts[0]}:${parts[1]}:${parts[2]}:${parts[3]}:${flipped}`;
  assert.equal(decryptSecret(tampered), '');
});

test('decryptSecret: malformed envelope returns empty', () => {
  assert.equal(decryptSecret('enc:v1:not:base64'), '');
  assert.equal(decryptSecret('enc:v1:only:two'), '');
});

// ---- structurallySafeUrl ---------------------------------------------------

test('structurallySafeUrl: accepts a normal https URL', () => {
  assert.equal(structurallySafeUrl('https://example.com/hook'), null);
  assert.equal(structurallySafeUrl('http://example.com:8080/hook'), null);
});

test('structurallySafeUrl: rejects non-http(s) schemes', () => {
  assert.match(structurallySafeUrl('file:///etc/passwd'), /http\(s\)/);
  assert.match(structurallySafeUrl('javascript:alert(1)'), /http\(s\)/);
  assert.match(structurallySafeUrl('ftp://example.com/'), /http\(s\)/);
  assert.match(structurallySafeUrl('gopher://example.com/'), /http\(s\)/);
});

test('structurallySafeUrl: rejects RFC1918 IPv4 literals', () => {
  assert.match(structurallySafeUrl('http://10.0.0.1/'), /private/i);
  assert.match(structurallySafeUrl('http://192.168.1.1/'), /private/i);
  assert.match(structurallySafeUrl('http://172.16.0.1/'), /private/i);
  assert.match(structurallySafeUrl('http://172.31.255.1/'), /private/i);
  assert.match(structurallySafeUrl('http://127.0.0.1/'), /private/i);
  assert.match(structurallySafeUrl('http://169.254.169.254/'), /private/i);
});

test('structurallySafeUrl: rejects IPv6 loopback, link-local, ULA', () => {
  assert.match(structurallySafeUrl('http://[::1]/'), /private/i);
  assert.match(structurallySafeUrl('http://[fe80::1]/'), /private/i);
  assert.match(structurallySafeUrl('http://[fc00::1]/'), /private/i);
  assert.match(structurallySafeUrl('http://[fd12:3456::1]/'), /private/i);
});

test('structurallySafeUrl: rejects IPv4-mapped IPv6 (::ffff:10.0.0.1)', () => {
  assert.match(structurallySafeUrl('http://[::ffff:10.0.0.1]/'), /private/i);
  assert.match(structurallySafeUrl('http://[::ffff:127.0.0.1]/'), /private/i);
});

test('structurallySafeUrl: rejects unparseable input', () => {
  assert.match(structurallySafeUrl('not a url'), /parseable/);
  assert.match(structurallySafeUrl(''), /parseable/);
});

// ---- assertUrlSafeAtDelivery (DNS-aware) -----------------------------------

test('assertUrlSafeAtDelivery: rejects localhost at DNS time', async () => {
  // `localhost` is intercepted by the OS resolver → 127.0.0.1 / ::1
  // even if WEBHOOK_ALLOW_PRIVATE_NETWORKS isn't set.
  const err = await assertUrlSafeAtDelivery('http://localhost:3001/hook');
  assert.ok(err && /private|localhost/i.test(err), `expected refusal, got: ${err}`);
});

test('assertUrlSafeAtDelivery: accepts a public-looking hostname (mocked)', async () => {
  // Patch dns.lookup to return a public IP for this test only.
  const original = dns.lookup;
  dns.lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  try {
    const err = await assertUrlSafeAtDelivery('http://example.com/hook');
    assert.equal(err, null);
  } finally {
    dns.lookup = original;
  }
});

test('assertUrlSafeAtDelivery: catches DNS rebinding (private IP after lookup)', async () => {
  // DNS-rebind attack: example.com resolves to a public IP at registration
  // time but to 169.254.169.254 at delivery time. The delivery-time check
  // is what stops this.
  const original = dns.lookup;
  dns.lookup = async () => [{ address: '169.254.169.254', family: 4 }];
  try {
    const err = await assertUrlSafeAtDelivery('http://example.com/hook');
    assert.ok(err && /private/i.test(err), `expected refusal, got: ${err}`);
  } finally {
    dns.lookup = original;
  }
});

test('assertUrlSafeAtDelivery: rejects DNS failure', async () => {
  const original = dns.lookup;
  dns.lookup = async () => { throw new Error('ENOTFOUND'); };
  try {
    const err = await assertUrlSafeAtDelivery('http://nonexistent.invalid/hook');
    assert.ok(err && /resolve/i.test(err), `expected resolve failure, got: ${err}`);
  } finally {
    dns.lookup = original;
  }
});

test('assertUrlSafeAtDelivery: rejects if ANY resolved address is private', async () => {
  // Real IPv6 happy-eyeballs can return multiple A/AAAA records; the
  // guard must reject if even one is in the private range.
  const original = dns.lookup;
  dns.lookup = async () => [
    { address: '93.184.216.34', family: 4 },
    { address: '10.0.0.5', family: 4 },
  ];
  try {
    const err = await assertUrlSafeAtDelivery('http://example.com/hook');
    assert.ok(err && /private/i.test(err), `expected refusal, got: ${err}`);
  } finally {
    dns.lookup = original;
  }
});
