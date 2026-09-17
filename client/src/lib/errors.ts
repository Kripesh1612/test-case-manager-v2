// =============================================================================
// client/src/lib/errors.ts — typed-error → human message helper.
//
// Shared by every feature that calls into the API and shows a toast /
// inline error on failure. The handful of feature pages used to define
// their own identical copies of this function; Tier2-PR-9 lifts it into
// `lib/` so the contract lives in one place and any future change (e.g.
// supporting a thrown `ApiError` class with `.message`) lands once.
//
// Contract:
//   - If `err` looks like an Axios-shaped error (has a `response.data.error`
//     string), return that string. The server's middleware stack already
//     wraps every 4xx in `{ error: '...' }`, so the user-visible message
//     reaches the toast without a re-translation step.
//   - Otherwise return `fallback`. This covers network errors, throws in
//     component code, and any unexpected exception shape (e.g. tanstack
//     `Error` boundary payloads that lack `.response`).
//
// Why string-typed, not a typed error class:
//   - The function runs at the boundary where the API failed; the caller
//     is presenting a message to a human. A richer class would let us
//     distinguish retryable / non-retryable, but no current consumer
//     branches on that.
//   - Keeping the signature `(unknown, string) => string` means callers
//     stay free of `import type` ceremony.
//
// Note on test coverage:
//   - The function is exercised end-to-end by every Cypress spec that
//     hits a 4xx response (e.g. 13-flakiness, 09-invites), which is
//     the integration surface worth keeping.
//   - A client-side unit test (Vitest) would be valuable once the
//     project stands up Vitest — the user-facing contract is two
//     branches. That work is intentionally NOT folded into this PR;
//     standing up the runner is a separate concern.
// =============================================================================

export function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return fallback;
}
