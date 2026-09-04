// =============================================================================
// AuthLayout — shared shell for /login, /register, and /invite-redeem.
//
// All three pages live INSIDE <AppShell /> (so the sidebar nav is visible
// to a logged-in admin navigating to /login from elsewhere), but the
// content is centred in a single card with a refined gradient backdrop
// and the brand mark on the right (large, subtle). The card itself
// stays narrow (~28rem) so the form feels intimate.
//
// Each page still mounts its own <div data-cy="login-card"> etc. inside
// the auth body so the existing Cypress contract is preserved.
// =============================================================================

import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { Logo } from '@/components/Logo';

export function AuthLayout({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="min-h-[calc(100vh-4rem)] grid lg:grid-cols-2 gap-0 -mx-4 sm:-mx-6 lg:-mx-10 -mt-6 sm:-mt-8 lg:-mt-8">
      {/* Left column — form card centred vertically */}
      <div className="flex items-center justify-center px-4 py-10 sm:px-8 lg:px-16 rg-dot-grid">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex justify-center">
            <Logo size={32} />
          </div>
          <div className="text-center mb-8">
            {eyebrow && (
              <div className="text-xs font-semibold uppercase tracking-wider text-brand mb-2">
                {eyebrow}
              </div>
            )}
            <h1 className="text-2xl font-semibold tracking-tight text-text">
              {title}
            </h1>
            {description && (
              <p className="mt-2 text-sm text-text-secondary">{description}</p>
            )}
          </div>
          {children}
        </div>
      </div>

      {/* Right column — brand panel, hidden on small screens */}
      <div className="hidden lg:flex relative items-center justify-center p-12 overflow-hidden border-l border-border">
        <BrandBackdrop />
        <div className="relative z-10 max-w-md text-text-inverse">
          <Link to="/">
            <Logo variant="inverse" size={36} />
          </Link>
          <h2 className="mt-10 text-4xl font-bold tracking-tight leading-tight">
            Catch what changed before your users do.
          </h2>
          <p className="mt-4 text-base text-text-inverse/80 leading-relaxed">
            Regress is a regression testing &amp; QA case manager. Version
            every test, diff the changes, run on a schedule, and let
            flakiness detection surface what humans can't reliably catch.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-text-inverse/90">
            <Feature icon="✓">Immutable version history for every test case</Feature>
            <Feature icon="✓">Side-by-side diff between any two versions</Feature>
            <Feature icon="✓">Built-in Cypress execution with live SSE stream</Feature>
            <Feature icon="✓">Flakiness scoring that learns over time</Feature>
          </ul>
        </div>
      </div>
    </div>
  );
}

function Feature({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <li className="flex items-start gap-2.5">
      <span className="mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-white/15 text-[10px] font-bold">
        {icon}
      </span>
      <span>{children}</span>
    </li>
  );
}

function BrandBackdrop() {
  // A subtle violet/indigo gradient with soft grid lines and a glowing orb.
  // Pure CSS so the page is light to render and printable.
  return (
    <div
      aria-hidden
      className="absolute inset-0"
      style={{
        background:
          'radial-gradient(ellipse 80% 60% at 80% 20%, #7C3AED 0%, #5B21B6 45%, #2E1065 100%)',
      }}
    >
      <div
        className="absolute inset-0 opacity-30"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(255 255 255 / 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgb(255 255 255 / 0.08) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          maskImage:
            'radial-gradient(ellipse 70% 80% at 50% 50%, black, transparent 80%)',
        }}
      />
      <div
        className="absolute -top-32 -right-32 h-96 w-96 rounded-full opacity-40"
        style={{
          background: 'radial-gradient(circle, #A78BFA, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
      <div
        className="absolute -bottom-32 -left-32 h-96 w-96 rounded-full opacity-30"
        style={{
          background: 'radial-gradient(circle, #818CF8, transparent 70%)',
          filter: 'blur(40px)',
        }}
      />
    </div>
  );
}

// =============================================================================
// Reusable field — preserves the data-cy contract the test suite queries
// against (e.g. login-email, register-password, invite-name-input).
// =============================================================================

import type { InputHTMLAttributes } from 'react';

type FieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string;
  leadingIcon?: ReactNode;
} & InputHTMLAttributes<HTMLInputElement>;

export function Field({ label, hint, error, leadingIcon, ...inputProps }: FieldProps) {
  return (
    <div>
      <label className="mb-1.5 block text-sm font-medium text-text">
        {label}
      </label>
      <div className="relative">
        {leadingIcon && (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
            {leadingIcon}
          </span>
        )}
        <input
          {...inputProps}
          className={`rg-input ${leadingIcon ? 'pl-9' : ''} ${
            error ? 'border-danger focus:border-danger focus:shadow-[0_0_0_3px_var(--color-danger-soft)]' : ''
          }`}
        />
      </div>
      {error ? (
        <p className="mt-1.5 text-xs text-danger-text">{error}</p>
      ) : hint ? (
        <p className="mt-1.5 text-xs text-text-tertiary">{hint}</p>
      ) : null}
    </div>
  );
}

export function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return fallback;
}
