// =============================================================================
// Unit tests for utils/webhooks.js — the webhook delivery engine.
//
// Run: npm run test:unit
//
// Coverage map (for defense review):
//   - _signPayload: empty secret → no signature; secret → hex HMAC
//   - _httpPost: 2xx resolves ok; 4xx resolves not-ok; bad URL rejects
//   - _httpPost: respects timeout (server never responds)
//   - deliverToWebhook: success records a delivery row & stops
//   - deliverToWebhook: 500 → retries then gives up (rows = retries+1)
//
// These tests spin a real http.Server so the full request path (headers,
// body, timeout socket destroy) is exercised, not mocked.
// =============================================================================

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

// The SSRF guard (added in batch A) rejects private/loopback addresses.
// Tests in this file start a local server bound to 127.0.0.1 — opt the
// guard out so the existing assertions still exercise the real http
// request path.
process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS = '1';

const { _signPayload, _httpPost, deliverToWebhook } = require('./webhooks');

// --- HMAC signature ------------------------------------------------------

test('_signPayload: empty secret produces no signature', () => {
  assert.equal(_signPayload('', '{"x":1}'), '');
  assert.equal(_signPayload(undefined, '{"x":1}'), '');
});

test('_signPayload: secret produces a hex HMAC-SHA256', () => {
  const sig = _signPayload('s3cret', '{"x":1}');
  assert.match(sig, /^[0-9a-f]{64}$/);
  // Deterministic for the same input.
  assert.equal(sig, _signPayload('s3cret', '{"x":1}'));
});

test('_signPayload: different body or secret changes the signature', () => {
  assert.notEqual(_signPayload('s3cret', '{"x":1}'), _signPayload('s3cret', '{"x":2}'));
  assert.notEqual(_signPayload('s3cret', '{"x":1}'), _signPayload('other', '{"x":1}'));
});

// --- HTTP POST -------------------------------------------------------------

function startServer(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({
        server,
        url: `http://127.0.0.1:${server.address().port}`,
      });
    });
  });
}

test('_httpPost: 2xx resolves ok=true', async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  try {
    const result = await _httpPost({ url, body: '{"a":1}' });
    assert.equal(result.ok, true);
    assert.equal(result.status, 200);
  } finally {
    server.close();
  }
});

test('_httpPost: 4xx resolves ok=false with status', async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(400);
    res.end('nope');
  });
  try {
    const result = await _httpPost({ url, body: '{}' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 400);
    // A 4xx is a protocol-level answer, not a transport failure — no throw.
  } finally {
    server.close();
  }
});

test('_httpPost: connection refused rejects (network error)', async () => {
  // Port 1 on localhost is almost certainly closed. If something is
  // listening there, the request would succeed — fall back to an
  // obviously-dead address.
  await assert.rejects(
    _httpPost({ url: 'http://127.0.0.1:1/', body: '{}', timeoutMs: 500 }),
    /ECONNREFUSED|timed out|timeout|Socket hang up|connect/i,
  );
});

test('_httpPost: invalid URL rejects', async () => {
  await assert.rejects(_httpPost({ url: 'not-a-url', body: '{}' }), /Invalid URL/);
});

test('_httpPost: times out when the server never responds', async () => {
  const { server, url } = await startServer((_req, _res) => {
    // Intentionally never respond.
  });
  try {
    await assert.rejects(
      _httpPost({ url, body: '{}', timeoutMs: 150 }),
      /timeout|aborted|socket hang up/i,
    );
  } finally {
    server.close();
  }
});

test('_httpPost: posts the body and content-type header', async () => {
  const { server, url } = await startServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      assert.equal(req.headers['content-type'], 'application/json');
      assert.deepEqual(JSON.parse(body), { ping: true });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('ok');
    });
  });
  try {
    const result = await _httpPost({ url, body: '{"ping":true}' });
    assert.equal(result.ok, true);
  } finally {
    server.close();
  }
});

// --- deliverToWebhook ------------------------------------------------------

// In-memory delivery recorder — lets the tests exercise the full retry
// loop without a live DB (same shape as the Prisma-backed default).
function memoryPersist() {
  const rows = [];
  return {
    rows,
    persist: async (data) => {
      rows.push(data);
      return { id: rows.length };
    },
  };
}

test('deliverToWebhook: happy path — single success delivery', async () => {
  const { server, url } = await startServer((req, res) => {
    res.writeHead(200);
    res.end('ok');
  });
  try {
    const mem = memoryPersist();
    const webhook = { id: -1, url, secret: '', event: 'test.ping' };
    const result = await deliverToWebhook(
      webhook,
      { event: 'test.ping', data: 1 },
      { retries: 1, persist: mem.persist, sleep: async () => {} },
    );
    assert.equal(result.attempts, 1);
    assert.equal(result.delivery_ids.length, 1);
    assert.equal(result.success, true);
    assert.equal(mem.rows.length, 1);
    assert.equal(mem.rows[0].success, true);
    assert.equal(mem.rows[0].status_code, 200);
  } finally {
    server.close();
  }
});

test('deliverToWebhook: server returns 500 → retries then gives up', async () => {
  // Count requests — expect retries+1 total attempts.
  let hits = 0;
  const { server, url } = await startServer((_req, res) => {
    hits += 1;
    res.writeHead(500);
    res.end('boom');
  });
  try {
    const mem = memoryPersist();
    const webhook = { id: -1, url, secret: '', event: 'test.ping' };
    const result = await deliverToWebhook(
      webhook,
      { event: 'test.ping' },
      { retries: 2, persist: mem.persist, sleep: async () => {} },
    );
    assert.equal(hits, 3, 'expected 3 attempts (1 + 2 retries)');
    assert.equal(result.attempts, 3);
    assert.equal(result.success, false);
    // Every failed attempt is persisted for the audit trail.
    assert.equal(mem.rows.length, 3);
    assert.ok(mem.rows.every((r) => r.success === false && r.status_code === 500));
  } finally {
    server.close();
  }
});

test('deliverToWebhook: network error (refused) retries and records error', async () => {
  const mem = memoryPersist();
  const webhook = { id: -1, url: 'http://127.0.0.1:1/', secret: '', event: 'test.ping' };
  const result = await deliverToWebhook(
    webhook,
    { event: 'test.ping' },
    { retries: 1, persist: mem.persist, sleep: async () => {} },
  );
  assert.equal(result.success, false);
  assert.ok(mem.rows.every((r) => r.error !== null && r.error !== undefined && r.status_code === null));
});

test('deliverToWebhook: includes HMAC signature header when secret set', async () => {
  let seenSig = null;
  const { server, url } = await startServer((req, res) => {
    seenSig = req.headers['x-regress-signature'];
    res.writeHead(200);
    res.end('ok');
  });
  try {
    const mem = memoryPersist();
    const webhook = { id: -1, url, secret: 'shared-key', event: 'test.ping' };
    await deliverToWebhook(
      webhook,
      { event: 'test.ping' },
      { retries: 0, persist: mem.persist, sleep: async () => {} },
    );
    assert.equal(seenSig, _signPayload('shared-key', '{"event":"test.ping"}'));
    assert.equal(seenSig !== null && seenSig.length, 64);
  } finally {
    server.close();
  }
});