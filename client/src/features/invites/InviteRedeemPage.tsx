// =============================================================================
// InviteRedeemPage — public route (no AppShell), accepts a token from the
// URL, asks for name + password, and issues a JWT.
//
// data-cy contract:
//   [data-cy="invite-redeem-card"]
//   [data-cy="invite-name-input"]
//   [data-cy="invite-password-input"]
//   [data-cy="invite-redeem-submit"]
//   [data-cy="invite-error"]
//
// This page renders OUTSIDE <AppShell /> so an invitee who has no token
// yet can still land on it. The /login + /register pages are now inside
// the shell (admin bounce to /login still works because the shell
// gracefully handles user=null).
// =============================================================================

import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';

import { http, setToken } from '@/lib/http';

import { Logo } from '@/components/Logo';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icons';
import { extractError } from '@/features/auth/AuthLayout';

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
      setToken(data.token);
      qc.setQueryData(['auth', 'me'], data.user);
      navigate('/dashboard', { replace: true });
    } catch (e) {
      setError(extractError(e, 'Invite redemption failed'));
    } finally {
      setSubmitting(false);
    }
  };

  const formDisabled = !hasToken || submitting;

  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="px-6 py-5 border-b border-border bg-surface/60 backdrop-blur">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Logo />
          <a
            href="/login"
            className="text-sm text-text-secondary hover:text-text"
          >
            Already have an account? <span className="text-brand font-medium">Sign in</span>
          </a>
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center px-4 py-10 rg-dot-grid">
        <div className="w-full max-w-md">
          <div data-cy="invite-redeem-card" className="rg-card p-6 sm:p-8">
            <div className="text-center mb-6">
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-brand-soft text-brand mb-3">
                <Icon.Mail size={22} />
              </div>
              <h1 className="text-xl font-semibold tracking-tight text-text">
                Accept your invite
              </h1>
              <p className="mt-1 text-sm text-text-secondary">
                Pick a name and password to join the workspace.
              </p>
            </div>

            <form onSubmit={onSubmit} className="space-y-4" noValidate>
              <div>
                <label htmlFor="invite-name" className="mb-1.5 block text-sm font-medium text-text">
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
                  className="rg-input"
                />
              </div>

              <div>
                <label htmlFor="invite-password" className="mb-1.5 block text-sm font-medium text-text">
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
                  className="rg-input"
                />
              </div>

              <Button
                type="submit"
                data-cy="invite-redeem-submit"
                disabled={formDisabled}
                loading={submitting}
                variant="primary"
                size="lg"
                className="w-full"
              >
                {submitting ? 'Accepting…' : 'Accept invite'}
              </Button>
            </form>

            {error && (
              <p
                data-cy="invite-error"
                className="mt-4 rounded-lg border border-danger-border bg-danger-soft px-3 py-2 text-sm text-danger-text"
              >
                {error}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
