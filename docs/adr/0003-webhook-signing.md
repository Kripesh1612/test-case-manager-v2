# ADR-0003 — Webhook signing + SSRF guard + replay support

- Status: Accepted
- Date: 2026-09-17
- Supersedes: —
- Related: [`docs/webhooks.md`](../webhooks.md), [`utils/webhooks.js`](../../utils/webhooks.js), [`utils/webhookSecret.js`](../../utils/webhookSecret.js), [`routes/webhooks.js`](../../routes/webhooks.js), [`docs/security-model.md`](../security-model.md) (rows 11, 12)

## Context

External systems need a way to react to events in Regress — for
example, a CI runner that reads results, or a Slack bridge that
posts "suite failed" to a channel. The naive design is "the
consumer gives us a URL and we POST a JSON blob to it." Three
classes of problem show up immediately:

1. **Authenticity.** A man-in-the-middle (or an attacker who
   registered the URL) could forge a payload. The consumer
   needs cryptographic proof that the POST came from this
   Regress instance and that the body is what we sent.
2. **URL target.** A malicious admin — or an admin whose
   session got hijacked — could register a webhook pointing
   at `http://169.254.169.254/latest/meta-data` (the cloud
   metadata endpoint). Every fired event would then probe
   internal services and the response body would land in
   `webhook_deliveries.payload`.
3. **Recovery from failure.** A consumer webhook that 500s on
   Tuesday should be re-deliverable without us having to
   leave the admin UI. And admins occasionally rotate the
   shared secret — that has to land in a single change
   without rewriting the signing function.

This ADR covers all three; each maps to one or two of the
attacks enumerated in `docs/security-model.md` (rows 11, 12).

## Decision

### 1. HMAC-SHA256 over the raw request body

Every outbound POST carries an `X-Regress-Signature: sha256=<hex>`
header where:

```
hex = HMAC-SHA256(key=<shared secret>, msg=<raw JSON body>)
```

The consumer computes the same MAC over the bytes they received
and rejects if the values disagree (constant-time compare, never
`===`). The raw body is what's signed — never the parsed object —
because any re-serialization by an intermediate proxy breaks the
MAC.

The signing function (`utils/webhooks.js#_signPayload`) refuses to
emit a header if `secret` is empty; that branch is for future
"unsubscribe and delete" flows. Today every webhook has a secret
(row 12 in the security model).

### 2. SSRF guard on registration AND on delivery

`validateWebhookUrl(url)` runs in two places:

- **On registration**, via Zod `.refine` in the request schema
  *and* a defensive second check at the start of the route
  handler. Two checks because a future router refactor could
  drop one of them; the defensive pair survives that.
- **On every delivery**, because DNS is authoritative at
  request time. A name that resolves to a public IP at
  registration can resolve to `10.0.0.5` (RFC1918) a moment
  later — that's a DNS-rebinding attack and we don't want
  to be the proxy.

`isPrivateOrReservedIp()` rejects every address in:

- IPv4: `10/8`, `127/8`, `169.254/16` (incl. AWS/GCP
  metadata), `172.16/12`, `192.168/16`, `100.64/10`
  (CGNAT), `0/8`, `224/4` and up, `198.18/15`
  (benchmarking), `192.0.0/24` (IETF), `192.0.2/24`
  (TEST-NET-1), `198.51.100/24` (TEST-NET-2),
  `203.0.113/24` (TEST-NET-3).
- IPv6: `::1` (loopback), `fc00::/7` (ULA), `fe80::/10`
  (link-local), plus IPv4-mapped recursion.

After resolving the hostname, the *resolved* IP is what's
checked, not the URL string. The delivery then pins
`http.Agent` to the resolved address (DNS-rebinding
mitigation at the transport layer).

The deployment can opt out via
`WEBHOOK_ALLOW_PRIVATE_NETWORKS=1`. Default is deny.

### 3. Per-delivery replay from the admin UI

Every attempt — including the retries — writes one
`webhook_deliveries` row recording `status_code`, `success`,
`error`, the request headers we sent, the truncated response
body (8 KB cap), and the timestamp. The admin UI's
"recent deliveries" panel reads these rows directly. A
failed delivery gets a "Replay" button that re-issues the
exact same payload with a fresh `X-Regress-Signature`
(current secret at the time of replay) and a new
`webhook_deliveries` row.

Why not redeliver-only-on-webhook-update: a transient 503
on the consumer side is the common case. Forcing an admin
to edit-then-save the webhook to retry is two clicks and
loses the retry history.

### 4. Secret rotation via one API call

`PUT /webhooks/:id/secret` swaps the stored secret without
touching the URL or any other config. The `webhook_secret`
table stores the secret *encrypted at rest* via
`utils/webhookSecret.js` (AES-GCM with a key derived from
`WEBHOOK_SECRET_KEY` or, for dev, a process-local random
default). Rotation invalidates no existing signatures —
HMAC keys are forward-only, so old in-flight deliveries
still verify under the secret that was active at sign
time.

## Consequences

Positive:

- **Tamper-evident payloads.** A consumer cannot accept a
  payload whose body has been altered by an intermediate
  proxy without the MAC failing. Replay protection is left
  to the consumer's own deduplication (every event carries
  a unique `delivery_id`).
- **No accidental SSRF exfil.** The `169.254` block alone
  closes the cloud-metadata hole that's behind every
  high-profile webhook bug of the last five years.
- **One-click recovery.** Every failed delivery is data an
  admin can re-send without re-creating the webhook.
- **Secret rotation without downtime.** A rotated secret
  coexists with the previous one during the rollout window
  for any consumer that pins signatures to the old value.

Negative:

- **Two checks to maintain.** The defensive double-validation
  (Zod `.refine` + handler `validateWebhookUrl`) is a 4-LOC
  cost paid in maintenance. We accept it because the
  alternative (single check) survives a router refactor only
  by coincidence.
- **DNS-rebinding race.** Resolving + checking + connecting
  is racy in the abstract; we close the race by pinning the
  `http.Agent` to the resolved IP. That means a future
  migration to a connection-pool library will need explicit
  support for pinned addresses.
- **Replay window.** The default retry policy is "2 retries
  with 100 ms backoff base". A consumer that misses a
  delivery should retry on its end if forward-progress
  matters; we don't keep an indefinite queue.

## Alternatives considered

- **mTLS / client certificates.** Heavier than the project's
  needs and requires a PKI the project doesn't run. The
  HMAC approach is the right size.
- **JWT instead of HMAC.** JWTs add a header and claims; for
  point-to-point delivery with no intermediary verification,
  a single MAC over the body is strictly simpler. JWT is
  worth adopting if we ever fan out to a third-party
  verifier (e.g. an HTTP gateway that filters on claims).
- **Slack-style `X-Slack-Signature` vs GitHub-style
  `X-Hub-Signature-256`.** Both are HMAC-SHA256; we picked
  the GitHub variant because the field name
  (`X-Regress-Signature`) is generic and the GitHub label
  is the more common convention consumers have libraries
  for.
- **Single SSRF check at registration only.** Rejected
  outright after the DNS-rebinding thought experiment.
- **Inline response body in the delivery row.** Capped at
  8 KB; a full body could exfiltrate secrets from a
  misconfigured consumer. Cap kept.

## Follow-ups

- The `privateOrReservedIp()` list is a static copy. When
  IANA publishes a new reserved block, update the
  comments and add a unit test.
- If a future feature requires per-event signing keys (e.g.
  for replay tokens), `webhook_secret` already has the
  encryption primitive to support that without a schema
  change.
- Add a `webhooks:test:ssl` admin endpoint that runs a
  TLS handshake check against an arbitrary URL — currently
  out of scope but useful.
