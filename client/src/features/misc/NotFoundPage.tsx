// =============================================================================
// NotFoundPage — full-bleed 404. Lives OUTSIDE the AppShell so it's a
// standalone "you've wandered off the map" page rather than an
// empty sidebar with a 404 inside it.
// =============================================================================

import { Link } from 'react-router-dom';
import { Logo } from '@/components/Logo';
import { Icon } from '@/components/Icons';

export function NotFoundPage() {
  return (
    <div className="min-h-screen flex flex-col bg-bg">
      <header className="px-6 py-5 border-b border-border bg-surface/60 backdrop-blur">
        <div className="max-w-6xl mx-auto">
          <Logo />
        </div>
      </header>
      <div className="flex-1 flex items-center justify-center px-6 rg-dot-grid">
        <div className="text-center max-w-md">
          <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-brand-soft text-brand mb-6">
            <Icon.Warning size={28} />
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-text">
            Nothing here
          </h1>
          <p className="mt-2 text-text-secondary">
            We couldn't find that page. The link might be old, or the case
            may have been moved to trash.
          </p>
          <Link
            to="/dashboard"
            className="mt-6 inline-flex items-center gap-2 rounded-lg border border-border bg-surface px-4 py-2 text-sm font-medium text-text hover:bg-surface-hover transition-colors"
          >
            <Icon.ArrowRight size={14} className="rotate-180" />
            Back to dashboard
          </Link>
        </div>
      </div>
    </div>
  );
}
