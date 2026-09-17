// middleware/csrf.js — Origin/Referer allowlist for non-safe requests.
//
// Audit C (CSRF): the API uses Bearer-token auth (not cookies), which
// historically defends against classic CSRF: a `<form>` posted from a
// malicious page doesn't carry the token, and the browser won't auto-
// attach it. That argument has two gaps in 2026:
//
//   1. The token lives in localStorage and is XSS-stealable. Once an
//      attacker has the token (XSS on the legit site, or a malicious
//      browser extension), Bearer auth alone doesn't constrain where
//      requests originate.
//
//   2. JSON POSTs from a malicious page can include arbitrary
//      `Authorization: Bearer <stolen>` headers IF the attacker has
//      the token — same issue as above.
//
// The defense in depth: on every non-safe request (POST/PUT/PATCH/
// DELETE), require the `Origin` (preferred) or `Referer` header to
// match an allowlist of trusted same-origin hosts. Browsers send
// `Origin` on cross-origin POSTs but `Referer` is universally present
// even on same-origin requests, so the fallback exists for clients
// that strip Origin (some XHR libraries / older IE).
//
// Trust comes from the same list used by the CORS middleware: the host
// the app is served from. The default is the request's own host when
// trust-proxy is on; explicit override via CSRF_ALLOWED_ORIGINS
// (comma-separated; "*" disables).

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

const defaultOriginsFor = (req) => {
  // Best-effort: the API is served from the same host as the page.
  // `req.protocol` is the scheme Express saw, which behind a trusted
  // proxy reflects the original URL.
  const proto = req.protocol || 'http';
  const host = req.get ? req.get('host') : null;
  if (!host) return [];
  return [`${proto}://${host}`];
};

const csrfGuard = (opts = {}) => {
  const envRaw = process.env.CSRF_ALLOWED_ORIGINS;
  const allowed = opts.allowed
    || (envRaw && envRaw !== '*'
        ? envRaw.split(',').map((s) => s.trim()).filter(Boolean)
        : null);
  const disabled = envRaw === '*';

  return (req, res, next) => {
    if (disabled) return next();
    if (SAFE_METHODS.has(req.method)) return next();
    // Allow server-to-server callers (CI jobs, programmatic tests) by
    // honouring CSRF_ALLOW_NO_ORIGIN=1. Default is OFF so a missing
    // Origin on a state-changing request is rejected — that's the
    // point of the check.
    const allowNone = process.env.CSRF_ALLOW_NO_ORIGIN === '1';
    const origin = req.get('origin');
    const referer = req.get('referer');
    if (!origin && !referer) {
      if (allowNone) return next();
      return res.status(403).json({
        error: 'Origin or Referer header required on state-changing requests',
      });
    }
    const list = allowed || defaultOriginsFor(req);
    if (!list.length) {
      if (allowNone) return next();
      return res.status(403).json({ error: 'CSRF allowlist is empty' });
    }
    const candidate = origin || (() => {
      try { return new URL(referer).origin; } catch (_) { return null; }
    })();
    if (!candidate) {
      return res.status(403).json({ error: 'Unparseable Origin/Referer' });
    }
    if (!list.includes(candidate)) {
      return res.status(403).json({
        error: `Origin ${candidate} not in CSRF allowlist`,
      });
    }
    return next();
  };
};

module.exports = { csrfGuard };
