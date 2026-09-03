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

module.exports = { parseId };