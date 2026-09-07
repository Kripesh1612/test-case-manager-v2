# Security Policy

## Supported Versions

This project follows semantic versioning. Security fixes are released for
the latest minor on the latest major.

| Version | Supported          |
| ------- | ------------------ |
| 1.x     | ✅ Active          |
| < 1.0   | ❌ End of life     |

The `main` branch always tracks the latest supported version. Older tags
may be patched on request if the fix is non-invasive, but new minor
versions are not back-ported.

## Reporting a Vulnerability

**Please do not file public GitHub issues for security-sensitive bugs.**

Email security reports to the maintainer directly
([Kripesh1612](https://github.com/Kripesh1612)) via GitHub's private
vulnerability disclosure flow on the
[repository's Security tab](https://github.com/Kripesh1612/test-case-manager-v2/security/advisories/new).
That routes through GitHub's coordinated disclosure channel and keeps
the report out of the public bug tracker until a fix is shipped.

Please include:

1. A clear description of the issue and the attack scenario.
2. Steps to reproduce, ideally with a proof-of-concept `curl` /
   `cypress` command against the running app.
3. The affected commit SHA or release tag, if known.
4. Whether you intend to disclose publicly, and on what timeline.

You should hear back within **72 hours** with an acknowledgement and a
rough triage timeline. We aim to ship a fix or mitigation within
**30 days** for confirmed critical issues, faster when the attack is
trivial to reproduce.

## Scope

This is a self-hosted test-case management tool. Out of scope:

- Issues in third-party dependencies that do not have a reachable
  exploit in this codebase. Please report those upstream.
- Denial-of-service against a developer-local instance running on
  `localhost` without authentication enabled (`REGISTRATION_MODE=open`
  + no reverse proxy).
- Theoretical attacks that require physical access to the host.

In scope:

- Authentication / authorization bypass (JWT, RBAC, ownership checks).
- Privilege escalation across admin / editor / viewer roles.
- SQL injection or any case where user input flows unsanitized into a
  Prisma query.
- Path traversal in artifact storage (`utils/artifactStore.js`).
- SSRF / RCE via the `TestCase.executable_snippet` runner. The executor
  intentionally executes user-supplied Cypress specs — that is a
  feature — but anything outside the intended runner surface is in
  scope.
- Rate-limit / abuse paths on auth endpoints.
- Sensitive data leakage (password hashes, JWT secrets, other users'
  audit trails) through any authenticated endpoint.

## Hardening Notes for Operators

A handful of the defaults below are deliberately permissive for local
development; tighten them in production.

- `JWT_SECRET` — **must** be overridden. The dev fallback
  (`'dev-secret-change-me'`) refuses to sign tokens if a `.env` is
  detected but the variable is absent, but a real deployment should set
  a 32+ byte random value.
- `REGISTRATION_MODE` — set to `invite` and provision users via
  `POST /invites` rather than leaving it at `open`.
- `TRUST_PROXY` — set to the count of trusted reverse proxies in front
  of the app (commonly `1` for a single nginx / cloud LB). The app
  reads `X-Forwarded-For` for rate limiting and audit logging.
- `RATE_LIMIT_LOGIN_MAX` / `RATE_LIMIT_REGISTER_MAX` — defaults are
  reasonable for a small team; lower them if you expose the app on
  the public internet.
- `TRASH_RETENTION_DAYS` — soft-deleted rows are purged by
  `utils/trashPurge.js`. The default is 30 days. Set `TRASH_PURGE_DISABLED=1`
  if you need to retain deleted rows indefinitely (e.g. for compliance).
- HTTPS termination is expected at the proxy. The app speaks plain HTTP
  on `PORT`; do not expose that port directly.

## Acknowledgements

Researchers who report valid in-scope issues will be credited in the
release notes (unless they prefer anonymity).
