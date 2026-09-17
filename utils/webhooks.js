// utils/webhooks.js — fire-and-forget webhook delivery engine.
//
// Webhooks let external systems subscribe to Regress events (currently
// `suite.run.completed`, fired after a suite execution finishes). This
// module owns the "deliver the payload" concern:
//
//   1. Look up every enabled webhook subscribed to the event, scoped to
//      the project the run happened in.
//   2. POST the payload as JSON with an HMAC-SHA256 signature header.
//   3. Respect a per-request timeout (WEBHOOK_TIMEOUT_MS, default 5s).
//   4. Retry transient failures up to WEBHOOK_RETRIES times with a small
//      delay between attempts.
//   5. Persist one WebhookDelivery row per attempt so admin UI can show
//      exactly what happened (status_code, success, error).
//
// Everything is best-effort and non-blocking: emitting never throws into
// the caller's request path, and delivery failures are recorded, not
// escalated. `WEBHOOKS_ENABLED=false` turns the whole thing off.
//
// Public surface:
//   emitSuiteRunCompleted(suiteId, outcome)   — fire suite.run.completed
//   deliverToWebhook(webhook, payload, opts)  — one-shot delivery (tests)
//   _signPayload / _httpPost                  — internal, exported for tests

const crypto = require('crypto');
const net = require('net');
const dns = require('dns').promises;
const prisma = require('../db');
const {
  getWebhookTimeoutMs,
  getWebhookRetries,
  getWebhookEnabled,
} = require('./settings');
const { decryptSecret } = require('./webhookSecret');

const EVENT_SUITE_RUN_COMPLETED = 'suite.run.completed';

// Default delay between retry attempts (ms). Exponent-shaped so a flaky
// endpoint gets a brief pause before we hammer it again.
const RETRY_DELAY_BASE_MS = 100;

const log = (...args) => console.log('[webhooks]', ...args);

// HMAC-SHA256 over the raw JSON body; sent as `X-Regress-Signature`.
// Consumers verify with the shared secret to prove the payload is from
// Regress and hasn't been tampered with.
function _signPayload(secret, body) {
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(body, 'utf8').digest('hex');
}

// --- SSRF guard --------------------------------------------------------------
//
// Any admin (or admin whose creds leaked) can register a webhook. Without
// validation, registering `http://169.254.169.254/latest/meta-data/...`
// turns every suite run into an SSRF probe — and the response body is
// captured into `webhook_deliveries.payload`, making the audit table an
// exfil channel.
//
// validateWebhookUrl() runs on registration (via the Zod `.refine` and
// again here defensively) AND on every delivery, because DNS is
// authoritative at request time: a name that resolved to a public IP at
// registration can resolve to an RFC1918 address a moment later.
//
// `WEBHOOK_ALLOW_PRIVATE_NETWORKS=1` opts the deployment out of the
// guard — useful for pointing webhooks at an internal CI runner on a
// trusted network. Default is deny.

const isPrivateOrReservedIp = (ip) => {
  // URL.hostname preserves brackets for IPv6 ([::1]); net.isIP rejects
  // bracketed input. Strip them defensively.
  const stripped = ip.startsWith('[') && ip.endsWith(']') ? ip.slice(1, -1) : ip;
  if (!net.isIP(stripped)) return true; // unparseable — reject
  if (net.isIPv4(stripped)) {
    const parts = stripped.split('.').map(Number);
    if (parts[0] === 10) return true;
    if (parts[0] === 127) return true;
    if (parts[0] === 169 && parts[1] === 254) return true; // link-local + AWS / GCP metadata
    if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
    if (parts[0] === 192 && parts[1] === 168) return true;
    if (parts[0] === 100 && parts[1] >= 64 && parts[1] <= 127) return true; // CGNAT
    if (parts[0] === 0) return true; // 0.0.0.0/8
    if (parts[0] >= 224) return true; // multicast + reserved
    if (parts[0] === 198 && (parts[1] === 18 || parts[1] === 19)) return true; // benchmarking
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 0) return true; // IETF
    if (parts[0] === 192 && parts[1] === 0 && parts[2] === 2) return true; // TEST-NET-1
    if (parts[0] === 198 && parts[1] === 51 && parts[2] === 100) return true; // TEST-NET-2
    if (parts[0] === 203 && parts[1] === 0 && parts[2] === 113) return true; // TEST-NET-3
    if (parts[0] >= 240) return true; // reserved
    return false;
  }
  // IPv6
  const lower = stripped.toLowerCase();
  if (lower === '::1') return true; // loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true; // ULA
  if (lower.startsWith('fe80:')) return true; // link-local
  if (lower.startsWith('::ffff:')) {
    // IPv4-mapped IPv6 — recurse on the embedded IPv4 portion.
    // Node normalizes the dotted form (10.0.0.1 → a00:1) so map back.
    const tail = lower.slice(7);
    let v4 = null;
    if (tail.includes('.')) {
      v4 = tail;
    } else {
      const hex = tail.split(':').filter(Boolean)[0] || '';
      if (hex.length === 8) {
        v4 = `${parseInt(hex.slice(0, 2), 16)}.${parseInt(hex.slice(2, 4), 16)}.${parseInt(hex.slice(4, 6), 16)}.${parseInt(hex.slice(6, 8), 16)}`;
      }
    }
    return v4 ? isPrivateOrReservedIp(v4) : true;
  }
  return false;
};

const allowPrivateNetworks = () =>
  (process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS || '').toLowerCase() === '1' ||
  (process.env.WEBHOOK_ALLOW_PRIVATE_NETWORKS || '').toLowerCase() === 'true';

// Synchronous structural check (used by the Zod schema on registration):
// rejects non-http(s) and rejects literal IP addresses that are private.
// Doesn't do DNS lookup; that happens at delivery time.
const structurallySafeUrl = (raw) => {
  let parsed;
  try {
    parsed = new URL(raw);
  } catch (_) {
    return 'url must be a parseable http(s) URL';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'url must use http(s)';
  }
  if (!allowPrivateNetworks()) {
    // If hostname is a literal IP, check it now. `parsed.hostname`
    // preserves brackets for IPv6 (`[::1]`); strip them before
    // `net.isIP` so the literal-IP path actually fires for v6.
    const host = parsed.hostname;
    const hostStripped = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host;
    if (net.isIP(hostStripped) && isPrivateOrReservedIp(hostStripped)) {
      return 'url must not point at a private, loopback, or link-local address';
    }
  }
  return null;
};

// Async DNS-aware check at delivery time. Resolves every A/AAAA record
// and rejects if ANY of them is in the private/reserved range. Catches
// the case where the hostname resolves to a public IP at registration
// but to 169.254.169.254 later (DNS rebinding).
const assertUrlSafeAtDelivery = async (rawUrl) => {
  if (allowPrivateNetworks()) return null;
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (e) {
    return `Invalid URL: ${e.message}`;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'url must use http(s)';
  }
  const host = parsed.hostname;
  if (host === 'localhost') return 'url must not point at localhost';
  let addrs = [];
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    return `Could not resolve hostname: ${e.message}`;
  }
  for (const a of addrs) {
    if (isPrivateOrReservedIp(a.address)) {
      return `url resolves to a private/reserved address (${a.address}); refusing to deliver`;
    }
  }
  return null;
};

// POST a JSON body to a URL using Node's http/https modules. Resolves to
// { status, ok } on an HTTP response (2xx => ok); rejects on network
// error or timeout so the caller can back off.
function _httpPost({ url, body, headers = {}, timeoutMs = getWebhookTimeoutMs() }) {
  return new Promise((resolve, reject) => {
    let mod;
    try {
      const parsed = new URL(url);
      mod = parsed.protocol === 'https:' ? require('https') : require('http');
    } catch (e) {
      reject(new Error(`Invalid URL: ${e.message}`));
      return;
    }

    const req = mod.request(
      url,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          'User-Agent': 'Regress-Webhooks/1.0',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const status = res.statusCode || 0;
          resolve({ status, ok: status >= 200 && status < 300 });
        });
      },
    );
    req.setTimeout(timeoutMs, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Deliver a payload to one webhook, persisting a Delivery row per attempt
// and retrying up to `retries` times on non-2xx / network errors.
// Resolves with { success, deliveries } once the campaign is over.
//
// `opts.persist` overrides the default Prisma-backed delivery recorder —
// unit tests pass an in-memory stub so no DB is needed. `opts.sleep`
// likewise lets tests collapse the retry backoff.
async function deliverToWebhook(webhook, payloadObj, opts = {}) {
  const retries = Number.isInteger(opts.retries) ? opts.retries : getWebhookRetries();
  const maxAttempts = retries + 1;
  const body = JSON.stringify(payloadObj);
  // The DB stores an encrypted-at-rest secret; decrypt before signing.
  const plaintextSecret = decryptSecret(webhook.secret);
  const signature = _signPayload(plaintextSecret, body);
  const headers = signature ? { 'X-Regress-Signature': signature } : {};
  const persist = opts.persist || persistDelivery;
  const wait = opts.sleep || sleep;
  const attemptIds = [];
  let lastSuccess = false;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let statusCode = null;
    let error = null;
    let success = false;
    try {
      // DNS-aware SSRF guard — runs on every attempt because a name that
      // resolved to a public IP a moment ago can resolve to a private one
      // now (DNS rebinding). Cheap when allowPrivateNetworks() is on.
      const ssrfError = await assertUrlSafeAtDelivery(webhook.url);
      if (ssrfError) throw new Error(ssrfError);
      const res = await _httpPost({ url: webhook.url, body, headers });
      statusCode = res.status;
      success = res.ok;
      if (!success) error = `HTTP ${res.status}`;
    } catch (e) {
      error = e.message;
    }
    lastSuccess = success;

    const delivery = await persist({
      webhook_id: webhook.id,
      event: payloadObj.event,
      payload: payloadObj,
      status_code: statusCode,
      success,
      error,
    });
    attemptIds.push(delivery && delivery.id !== null && delivery.id !== undefined ? delivery.id : attempt);

    if (success) break;

    // Transient failure — back off, then retry (unless this was the last
    // attempt).
    const gaveUp = attempt >= maxAttempts;
    if (!gaveUp) {
      log('delivery to', webhook.url, 'failed on attempt', attempt, '— retrying');
      await wait(RETRY_DELAY_BASE_MS * attempt);
    } else {
      log('delivery to', webhook.url, 'gave up after', maxAttempts, 'attempt(s)');
    }
  }

  return {
    success: lastSuccess,
    webhook_id: webhook.id,
    attempts: attemptIds.length,
    delivery_ids: attemptIds,
  };
}

// persistDelivery — default recorder backed by Prisma.
async function persistDelivery({ webhook_id, event, payload, status_code, success, error }) {
  const row = await prisma.webhookDelivery.create({
    data: {
      webhook: { connect: { id: webhook_id } },
      event,
      payload,
      status_code,
      success,
      error,
    },
  });
  return { id: row.id };
}

// emitSuiteRunCompleted — fire suite.run.completed for every enabled
// webhook subscribed to that event in the run's project. Non-blocking:
// returns a Promise that resolves after all deliveries are recorded, but
// called code should `await` it only in tests; in request handlers we
// deliberately don't block on it.
async function emitSuiteRunCompleted({ suiteId, projectId, outcome }) {
  if (!getWebhookEnabled()) return [];

  let webhooks = [];
  try {
    webhooks = await prisma.webhook.findMany({
      where: { enabled: true, event: EVENT_SUITE_RUN_COMPLETED, project_id: projectId || 1 },
    });
  } catch (e) {
    log('lookup failed:', e.message);
    return [];
  }

  if (!webhooks.length) return [];

  const payload = {
    event: EVENT_SUITE_RUN_COMPLETED,
    suite_id: suiteId,
    project_id: projectId || 1,
    outcome,
    delivered_at: new Date().toISOString(),
  };

  log('delivering', EVENT_SUITE_RUN_COMPLETED, 'to', webhooks.length, 'webhook(s)');
  const results = await Promise.allSettled(
    webhooks.map((w) => deliverToWebhook(w, payload)),
  );
  return results.map((r) => (r.status === 'fulfilled' ? r.value : { error: r.reason.message }));
}

module.exports = {
  EVENT_SUITE_RUN_COMPLETED,
  emitSuiteRunCompleted,
  deliverToWebhook,
  _signPayload,
  _httpPost,
  // SSRF guard exports (used by the Zod schema and by tests).
  structurallySafeUrl,
  assertUrlSafeAtDelivery,
  allowPrivateNetworks,
  _buildPayloadForSuiteRun: (suiteId, outcome) => ({
    event: EVENT_SUITE_RUN_COMPLETED,
    suite_id: suiteId,
    outcome,
    delivered_at: new Date().toISOString(),
  }),
};