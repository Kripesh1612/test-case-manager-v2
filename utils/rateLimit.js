// utils/rateLimit.js
//
// Tiny in-memory token-bucket rate limiter. Avoids adding a dependency
// for one endpoint pair.
//
// Trade-offs (intentional, documented for future swap):
//   - state is per-process, so a multi-process deployment shares no
//     counters. Fine for single-container deployment; for multi-process
//     swap for Redis or a shared store.
//   - the Map is bounded by `windowMs` *requests per minute* *unique IPs,
//     which is small in practice for a single deployment.
//   - reads `req.ip`. Express sets this from x-forwarded-for when
//     `app.set('trust proxy', ...)` is on, so deploy behind a trusted
//     proxy only.

const AUTH_WINDOW_MS = 60_000;       // 60-second window
const AUTH_MAX = 10;                 // 10 attempts per window per IP

// key -> { count, windowStartMs }
const buckets = new Map();

// Periodic cleanup so the Map doesn't grow without bound. Started
// once per process.
let cleanupTimer = null;
function ensureCleanup(windowMs) {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(() => {
    const now = Date.now();
    for (const [k, b] of buckets) {
      if (now - b.windowStartMs > windowMs) buckets.delete(k);
    }
  }, windowMs);
  if (cleanupTimer.unref) cleanupTimer.unref();
}

function getIp(req) {
  // Fall back to a sentinel so a misconfigured proxy doesn't silently
  // disable the limiter.
  return (
    req.ip ||
    (req.connection && req.connection.remoteAddress) ||
    'unknown'
  );
}

function makeRateLimiter({
  windowMs = AUTH_WINDOW_MS,
  max = AUTH_MAX,
  keyPrefix = 'rl',
} = {}) {
  ensureCleanup(windowMs);

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = `${keyPrefix}:${getIp(req)}`;
    const b = buckets.get(key);
    if (!b || now - b.windowStartMs > windowMs) {
      buckets.set(key, { count: 1, windowStartMs: now });
      return next();
    }
    b.count += 1;
    if (b.count > max) {
      const retryAfter = Math.ceil(
        (windowMs - (now - b.windowStartMs)) / 1000
      );
      res.set('Retry-After', String(retryAfter));
      return res
        .status(429)
        .json({ error: 'too_many_requests', retryAfter });
    }
    return next();
  };
}

module.exports = { makeRateLimiter };
