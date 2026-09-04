// =============================================================================
// AppShell — sidebar + topbar layout for all authenticated pages.
//
// Two columns:
//   ┌──────────┬─────────────────────────────┐
//   │ sidebar  │  main content (via Outlet)  │
//   └──────────┴─────────────────────────────┘
//
// Sidebar nav items always render (with `hidden` flag where role-gated)
// so Cypress queries like `cy.get('[data-cy="tab-admin"]')` keep finding
// the element even when it's invisible — same contract as the old
// top-nav implementation, just relocated.
//
// RBAC: viewers can't write. We add `role-viewer` to the root element
// (the index.css rule hides everything with `data-writable="true"`),
// matching the vanilla admin.js behaviour the existing RBAC test relies on.
// =============================================================================

import { useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';
import { Logo } from './Logo';
import { Icon } from './Icons';

type NavItem = {
  to: string;
  label: string;
  icon: keyof typeof Icon;
  // If set, the item is rendered (so cy.get finds it) but invisible unless
  // the user's role is in `roles`.
  roles?: Array<'admin' | 'editor' | 'viewer'>;
  dataCy: string;
};

const NAV: NavItem[] = [
  { to: '/dashboard', label: 'Dashboard', icon: 'Dashboard', dataCy: 'tab-dashboard' },
  { to: '/cases', label: 'Cases', icon: 'Cases', dataCy: 'tab-cases' },
  { to: '/suites', label: 'Suites', icon: 'Suites', dataCy: 'tab-suites' },
  { to: '/scheduler', label: 'Scheduler', icon: 'Schedule', dataCy: 'tab-scheduler' },
  { to: '/admin', label: 'Admin', icon: 'Admin', roles: ['admin'], dataCy: 'tab-admin' },
  { to: '/trash', label: 'Trash', icon: 'Trash', dataCy: 'tab-trash' },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const roleClass = user ? `role-${user.role}` : '';
  return (
    <div
      className={`min-h-screen flex ${roleClass}`}
      data-user-role={user?.role ?? ''}
    >
      {/* Sidebar — hidden on small screens so the layout collapses to
          just the topbar. We use `hidden md:flex` rather than a burger
          menu because the sidebar is feature-complete (no secondary nav),
          and the existing Cypress suite exercises it at desktop widths. */}
      <aside className="hidden md:flex md:w-60 lg:w-64 flex-shrink-0 flex-col border-r border-border bg-surface/60 backdrop-blur-sm">
        <div className="px-5 py-5 border-b border-border-soft">
          <Link to="/" className="inline-flex">
            <Logo />
          </Link>
          <div className="mt-1.5 text-xs text-text-tertiary pl-9">
            Catch what changed before your users do.
          </div>
        </div>
        <nav className="flex-1 p-3 space-y-0.5">
          {user && NAV.map((item) => {
            const IconCmp = Icon[item.icon];
            const visible = !item.roles || item.roles.includes(user.role);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                data-cy={item.dataCy}
                hidden={!visible}
                className={({ isActive }) =>
                  `rg-nav-item${isActive ? ' rg-nav-item-active active' : ''}`
                }
              >
                <IconCmp size={16} />
                <span>{item.label}</span>
              </NavLink>
            );
          })}
          {!user && (
            <div className="px-3 py-6 text-sm text-text-secondary">
              Sign in to get started.
            </div>
          )}
        </nav>
        <div className="p-3 border-t border-border-soft">
          <div className="px-2 py-1 text-[10px] uppercase tracking-wider text-text-tertiary">
            Regress
          </div>
          <div className="px-2 text-xs text-text-tertiary">v1.0 · MIT</div>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={user} onLogout={logout} />
        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-8 max-w-[1400px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function TopBar({
  user,
  onLogout,
}: {
  user: { email: string; role: 'admin' | 'editor' | 'viewer' } | null;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10 border-b border-border bg-bg/80 backdrop-blur-md">
      <MobileBrand />
      <div className="flex items-center gap-2">
        {user ? (
          <ProfileMenu email={user.email} role={user.role} onLogout={onLogout} />
        ) : (
          <div className="text-sm text-text-secondary">Not signed in</div>
        )}
      </div>
    </header>
  );
}

// Mobile-only brand mark (sidebar is hidden < md, so we still need the logo).
function MobileBrand() {
  return (
    <Link to="/" className="md:hidden">
      <Logo size={22} />
    </Link>
  );
}

function ProfileMenu({
  email,
  role,
  onLogout,
}: {
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  onLogout: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  useEffect(() => {
    // Close the menu on route change so a click → navigate doesn't leave
    // the menu visually stuck open.
    setOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const initials = email
    .split('@')[0]
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-cy="profile-btn"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2.5 rounded-full border border-border bg-surface py-1 pl-1 pr-3 hover:bg-surface-hover transition-colors"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand text-text-inverse text-xs font-semibold">
          {initials}
        </span>
        <span className="hidden sm:inline text-xs text-text-secondary max-w-[120px] truncate">
          {email}
        </span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-64 rounded-xl border border-border bg-surface shadow-pop overflow-hidden rg-fade-in"
        >
          <div className="px-4 py-3 border-b border-border-soft">
            <div className="text-xs text-text-tertiary">Signed in as</div>
            <div className="mt-0.5 text-sm font-medium text-text truncate">{email}</div>
            <div className="mt-2">
              <span
                data-cy="profile-role-admin"
                className={`role-pill role-${role}`}
              >
                {role}
              </span>
            </div>
          </div>
          <button
            type="button"
            data-cy="logout-btn"
            onClick={onLogout}
            className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm text-text hover:bg-surface-hover transition-colors"
          >
            <Icon.Logout size={16} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
