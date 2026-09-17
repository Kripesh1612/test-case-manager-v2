// parseId — turn a route param into a positive integer or null.
//
// Why: `parseInt('abc')` → NaN, and a downstream prisma.findUnique({ where:
// { id: NaN } }) throws P2025 → 500. parseId turns the failure into a clean
// 404 (caller's responsibility) and also future-proofs `/trash` vs `/:id`
// route collisions: any `:id` that doesn't look like a number is rejected
// before it reaches the `/:id` handler.

const parseId = (raw) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
};

// clampInt — parse a query string and clamp the value into [lo, hi].
// Returns `dflt` when the input is missing, non-numeric, or NaN.
//
// Audit C (pagination): every list endpoint now goes through clampInt
// to bound the result set. Without a cap, a workspace with 10k cases
// would dump the entire table in one response. The cap is per-call;
// clients that need more rows page through via offset.
const clampInt = (raw, lo, hi, dflt) => {
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
};

module.exports = { parseId, clampInt };