// Public page at /invite-redeem — handles the token URL param, asks for
// name + password, and on success issues the JWT and bounces the new
// user to /dashboard.
//
// The data-cy contract mirrors public/invite-redeem.html so the existing
// Cypress UI spec keeps passing:
//
//   [data-cy="invite-redeem-card"]
//   [data-cy="invite-name-input"]
//   [data-cy="invite-password-input"]
//   [data-cy="invite-redeem-submit"]
//   [data-cy="invite-error"]
//
// We migrated this from vanilla JS because Cypress's `cy.visit` with
// `testIsolation: false` does a soft SPA navigation rather than a full
// reload when the URL changes inside an already-mounted React app — so
// the React app from a previous test (e.g. /admin) stays mounted, its
// auth check fires /auth/me, the 401 interceptor redirects to /login,
// and the vanilla HTML never gets a chance to render. Making
// /invite-redeem a real React route (outside ProtectedRoute) means the
// soft navigation lands here and the form renders as expected.
//
// Why this route is OUTSIDE ProtectedRoute: the invitee has no token
// yet (they're about to receive one). Wrapping this in the auth gate
// would be a chicken-and-egg redirect-loop.

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { http, setToken } from '@/lib/http';

interface RedeemResponse {
  user: { id: number; email: string; name: string | null; role: string };
  token: string;
}

export function InviteRedeemPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const token = params.get('token') ?? '';
  const hasToken = token.length > 0;

  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Show the "missing token" error synchronously on mount so Cypress's
  // `cy.get('[data-cy="invite-error"]').should('be.visible')` sees it
  // without needing a render tick.
  useEffect(() => {
    if (!hasToken) {
      setError('Missing invite token. Use the link from your invitation email.');
    }
  }, [hasToken]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!hasToken) return;
    setError(null);
    setSubmitting(true);
    try {
      const { data } = await http.post<RedeemResponse>('/invites/redeem', {
        token,
        name: name.trim(),
        password,
      });
      // Persist the JWT and seed the /me cache so the next page load
      // is already authed (matching what the vanilla flow did).
      setToken(data.token);
      qc.setQueryData(['auth', 'me'], data.user);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      const msg = extractError(e, 'Invite redemption failed');
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  };

  const formDisabled = !hasToken || submitting;

  return (
    <div data-cy="invite-redeem-card" className="mx-auto max-w-sm rounded border border-gray-200 bg-white p-6 shadow-sm">
      <h2 className="mb-2 text-2xl font-semibold">Accept your invite</h2>
      <p className="mb-4 text-sm text-gray-600">You've been invited to join.</p>

      <form onSubmit={onSubmit} className="space-y-4" noValidate>
        <div>
          <label htmlFor="invite-name" className="mb-1 block text-sm font-medium text-gray-700">
            Your name
          </label>
          <input
            id="invite-name"
            data-cy="invite-name-input"
            type="text"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={formDisabled}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
        </div>

        <div>
          <label htmlFor="invite-password" className="mb-1 block text-sm font-medium text-gray-700">
            Choose a password
          </label>
          <input
            id="invite-password"
            data-cy="invite-password-input"
            type="password"
            autoComplete="new-password"
            required
            minLength={6}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={formDisabled}
            className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-50"
          />
        </div>

        <button
          type="submit"
          data-cy="invite-redeem-submit"
          disabled={formDisabled}
          className="w-full rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {submitting ? 'Accepting…' : 'Accept invite'}
        </button>
      </form>

      {error && (
        <p
          data-cy="invite-error"
          className="mt-4 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700"
        >
          {error}
        </p>
      )}

      <p className="mt-4 text-sm text-gray-600">
        Already have an account?{' '}
        <a href="/login" className="text-blue-600 hover:underline">
          Sign in
        </a>
      </p>
    </div>
  );
}

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return fallback;
}