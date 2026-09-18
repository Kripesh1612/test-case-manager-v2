# Audit findings — five-batch sweep

- Status: Historical record, kept current with main
- Last updated: 2026-09-18
- Related: [`docs/security-model.md`](./security-model.md) (STRIDE catalogue with per-row `Closed by` column), [`docs/DEFENSE_ANALYSIS.md`](./DEFENSE_ANALYSIS.md) §14 "Defense talking points"
- Repo: [github.com/Kripesh1612/test-case-manager-v2](https://github.com/Kripesh1612/test-case-manager-v2)

## Summary table

| Batch | Severity | Theme | Commits | Distinct findings | Open | Example finding |
|-------|----------|-------|---------|--------------------|------|-----------------|
| A — security | High | Auth / webhook surface | 1 | 4 | 0 | Webhook URL registered against `http://10.0.0.1/internal` (SSRF) — row 11 |
| B — high-severity | High | Digest loop + webhook verification + indexes | 3 | 6 | 0 | Digest loop re-entrancy when two ticks overlap |
| C — medium-severity | Medium | Pagination / RBAC / crypto / redaction | 5 | ≥18 (commits bundle related items) | 0 | Unbounded list endpoints (page-size capping) — row 10 |
| D — low-severity | Low | Docs + client/server cleanup | 3 | ~7 | 0 | Duplicate JWT section header in README |
| E — post-sweep | Mixed | Regression hardening + memory ceiling | 2 | 6 | 0 | Executor memory-DoS via chatty Cypress stdout — row 15 |

**Total: 5 batches, 14 commits, ≥41 distinct findings, 0 open.**

Per-batch detail follows. The "Distinct findings" column is intentionally
the lower bound — a single commit may bundle several related fixes (e.g.
batch-C's `2fd8dc5` lands five at once: transactional mutations, audit
redaction, RBAC ownership, validation, last-admin guard). Where commits
bundle items, the per-finding count is estimated from the commit
message; the authoritative artefact is the diff.

## Batch A — security (high)

**Branch:** `fix/audit-batch-a-security`
**Severity:** high (security primitives)
**Commits:** 1

| SHA | Title | Findings |
|---|---|---|
| `4112889` | `fix(audit-batch-A): invite-token leak, webhook SSRF/secret/FK, SMTP rewrite` | (a) invite token leak via query-string caching; (b) webhook SSRF on registration; (c) webhook secret stored plaintext → encrypted at rest; (d) `Webhook.projectId` FK cascade was missing |

These map to security-model.md rows 11 (SSRF) and 12 (tamper-evident
delivery). Email/SMTP rewrite is captured in
[`docs/webhooks.md`](./webhooks.md) and the audit narrative. **Open: 0.**

## Batch B — high-severity

**Branch:** `fix/audit-batch-b-high-severity`
**Severity:** high (correctness — the digest loop was the schedulability
backbone for digest campaigns)
**Commits:** 3

| SHA | Title | Findings |
|---|---|---|
| `027587a` | `fix(audit-batch-B): digest loop hardening — env-var helper, re-entrancy guard, DB atomic claim` | (a) digest loop had no env-var helper so the same string was parsed in three places; (b) two ticks overlapping could double-fire; (c) the dequeue select was non-atomic so the second tick saw an in-flight row |
| `b4fde0a` | `fix(audit-batch-B): webhook URL guard tests, project_id indexes, digest_logs columns` | (a) webhook URL guard had no test; (b) `Webhook.project_id` and `DigestLog.project_id` lacked indexes — sequential scans at 100+ rows; (c) `digest_logs` was missing the columns the consumer endpoint requires |
| `0dd07f0` | `docs(audit-batch-B): reconcile test counts to 388; remove debug spec` | (a) test counts in docs were drifting from reality; (b) a Cypress debug spec had been left in the repo |

**Open: 0.** The re-entrancy guard is the optimistic-claim pattern later
documented in [`docs/adr/0002-scheduler-design.md`](./adr/0002-scheduler-design.md).

## Batch C — medium-severity

**Branch:** `fix/audit-batch-c-medium-severity`
**Severity:** medium (defence-in-depth + correctness)
**Commits:** 5

| SHA | Title | Findings |
|---|---|---|
| `3e0da03` | `fix(audit-batch-C): audit-log redaction, login timing-safe path, JWT alg pin, bcrypt 12, rate-limit defaults` | 5 findings (each line of the commit message) — covers audit redaction (rows 9), timing-safe compare, JWT alg pinning (row 22), bcrypt rounds bumped to 12, rate-limit defaults |
| `2fd8dc5` | `fix(audit-batch-C): transactional mutations, audit redaction, RBAC ownership, validation, last-admin guard` | 5 findings: transactional mutation wrappers, audit redaction (overlaps with 3e0da03 — both fixed in their context), ownership middleware, validation tightening, last-admin guard |
| `b327aae` | `fix(audit-batch-C): soft-delete scope helpers, started_at validation, run-finish idempotency` | 3 findings: scope helpers for soft-deleted rows, `started_at` validation, run-finish idempotency |
| `e1fc84a` | `fix(audit-batch-C): paginate unbounded list endpoints` | 1 finding spanning ~10 endpoints (row 10) |
| `db8a12c` | `fix(audit-batch-C): CSRF origin guard, JWT lifetime 24h, error-log scrubbing, schema tightening` | 4 findings: CSRF origin guard (row 4), JWT 24h lifetime (row 3), error-log redaction (row 20), schema tightening |

**Open: 0.** This batch was the largest and made the project safe to
hand to a wider audience (any actor who isn't an admin now fails the
CSRF check before the request even reaches the body parser).

## Batch D — low-severity

**Branch:** `fix/audit-batch-d-low-severity`
**Severity:** low (hygiene / docs / minor client-server cleanups)
**Commits:** 3

| SHA | Title | Findings |
|---|---|---|
| `85e1959` | `fix(audit-batch-D): server-side low-severity cleanups` | ~3 findings — non-blocking items: unused imports, defensive `null` checks that were always `undefined`, one slow query |
| `76bdfd3` | `fix(audit-batch-D): client-side low-severity cleanups` | ~3 findings — React `key` warnings, an `console.log` left in dev, one unhandled rejection in a Cypress helper |
| `dda1273` | `fix(audit-batch-D): remove duplicate JWT section header` | 1 finding — README had a duplicated "JWT" section that disagreed with itself |

**Open: 0.** These are the kind of items that get noticed when reading
the codebase top-to-bottom, but don't move any security needle.

## Batch E — post-sweep

**Branch:** `fix/audit-batch-e-post-sweep`
**Severity:** mixed (regressions caught after B/C/D landed + memory
ceilings)
**Commits:** 2

| SHA | Title | Findings |
|---|---|---|
| `1b8737e` | `fix(audit-batch-E): regression fix + memory-DoS + invite RBAC + dead code` | 4 findings: (a) C-2 introduced a regression in the runner-exit path; (b) executor had no stdout/stderr cap (row 15 — 256 KB rolling buffer); (c) invites could be created against a foreign project (row 8); (d) a stub `deadCode()` helper in `utils/auth.js` |
| `371bc51` | `fix(audit-batch-E): README rate-limit defaults + .env.example SMTP/JWT entries` | 2 docs findings: rate-limit defaults in README did not match code, and `.env.example` was missing SMTP + JWT entries that production would actually need |

**Open: 0.** E is called "post-sweep" because after B/C/D landed, the
remaining items were either regressions introduced *by* B/C/D or items
the original audit had rated below its cutoff.

## What's "open"

The audit-fixing work itself has 0 open findings. Two distinctions are
worth preserving so the question "is anything still open?" has a clean
answer:

**1. Pre-existing items in the STRIDE catalogue.**
[`docs/security-model.md`](./security-model.md) uses the
**`Pre-existing`** tag on rows where the control predated the audit and
the audit didn't touch them. These include OpenID/SSO (not implemented),
some flaky-test heuristics, and the `tcm-app` storage-permission fix
(which the Dockerfile `RUN mkdir -p /app/storage && chown -R node:node
/app/storage` at line 75 already handles). They are *not* audit-driven
work; they are scope items that pre-date or sit beside the audit.

**2. Future-work improvements in ADR follow-ups.**
Each ADR (`docs/adr/000[2-4]-*.md`) carries a "Follow-ups" section —
scheduler tick cadence past ~50 jobs, `@reboot` cron syntax, future
S3 swap for the artifact store. These are deferred enhancements, not
audit findings.

## Defence-talking-point cross-reference

If a panel asks "did you fix every finding?" the answer row is the
number of batches (5), the number of commits (14), and the number
of distinct findings (≥41). The commit list above is the receipt.
If a panel asks "how do you know a particular control isn't lying
in the docs?", each row in [`docs/security-model.md`](./security-model.md)
has a "Closed by" cell that points at the audit batch that forced the
control to exist.
