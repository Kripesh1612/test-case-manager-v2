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
import { useProjects, useSwitchProject } from '@/features/projects/hooks';
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
  { to: '/admin/projects', label: 'Projects', icon: 'Box', roles: ['admin'], dataCy: 'tab-projects' },
  { to: '/admin/webhooks', label: 'Webhooks', icon: 'Webhook', roles: ['admin'], dataCy: 'tab-webhooks' },
  { to: '/admin/digest', label: 'Digest', icon: 'Mail', roles: ['admin'], dataCy: 'tab-digest' },
  { to: '/visual', label: 'Visual', icon: 'Cases', roles: ['admin', 'editor'], dataCy: 'tab-visual' },
  { to: '/trash', label: 'Trash', icon: 'Trash', dataCy: 'tab-trash' },
];

export function AppShell() {
  const { user, logout } = useAuth();
  const roleClass = user ? `role-${user.role}` : '';
  const location = useLocation();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // Close the drawer on route change so a nav-click → navigate doesn't
  // leave the drawer visually stuck open over the new page.
  useEffect(() => setSidebarOpen(false), [location.pathname]);

  // Escape-to-close + body-scroll-lock while the mobile drawer is open.
  useEffect(() => {
    if (!sidebarOpen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setSidebarOpen(false);
    }
    document.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [sidebarOpen]);

  return (
    <div
      className={`min-h-screen flex ${roleClass}`}
      data-user-role={user?.role ?? ''}
    >
      {/* Sidebar — desktop: persistent column. Mobile (<md): hidden until
          the burger toggles `sidebarOpen`; then renders as a slide-in
          drawer over a backdrop. Same DOM, different positioning. */}
      <aside
        data-cy="app-sidebar"
        className={[
          'flex flex-col border-r border-border bg-surface/60 backdrop-blur-sm flex-shrink-0',
          // Desktop: always visible as a column.
          'md:flex md:w-60 lg:w-64 md:static',
          // Mobile: hidden by default, fixed overlay when open.
          sidebarOpen ? 'fixed inset-y-0 left-0 z-40 w-72 flex' : 'hidden',
        ].join(' ')}
      >
        <div className="px-5 py-5 border-b border-border-soft flex items-center justify-between">
          <div>
            <Link to="/" className="inline-flex" onClick={() => setSidebarOpen(false)}>
              <Logo />
            </Link>
            <div className="mt-1.5 text-xs text-text-tertiary pl-9">
              Catch what changed before your users do.
            </div>
          </div>
          {/* Close button — only meaningful on mobile (md:hidden). */}
          <button
            type="button"
            data-cy="sidebar-close"
            aria-label="Close navigation"
            onClick={() => setSidebarOpen(false)}
            className="md:hidden inline-flex h-8 w-8 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-brand"
          >
            <Icon.X size={18} />
          </button>
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
                onClick={() => setSidebarOpen(false)}
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

      {/* Backdrop — only on mobile when the drawer is open. Click to close. */}
      {sidebarOpen && (
        <div
          data-cy="sidebar-backdrop"
          aria-hidden
          onClick={() => setSidebarOpen(false)}
          className="fixed inset-0 z-30 bg-bg/60 backdrop-blur-sm md:hidden"
        />
      )}

      {/* Main column */}
      <div className="flex-1 flex flex-col min-w-0">
        <TopBar user={user} onLogout={logout} onOpenSidebar={() => setSidebarOpen(true)} />
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
  onOpenSidebar,
}: {
  user: { email: string; role: 'admin' | 'editor' | 'viewer'; project_name?: string | null; projectId?: number } | null;
  onLogout: () => void;
  onOpenSidebar: () => void;
}) {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-10 border-b border-border bg-bg/80 backdrop-blur-md">
      <div className="flex items-center gap-3">
        {/* Burger — only on mobile, since the sidebar is hidden below md. */}
        <button
          type="button"
          data-cy="sidebar-toggle"
          aria-label="Open navigation"
          onClick={onOpenSidebar}
          className="md:hidden inline-flex h-9 w-9 items-center justify-center rounded-md text-text-secondary hover:bg-surface-hover transition-colors focus:outline-none focus:ring-2 focus:ring-brand"
        >
          <Icon.Menu size={20} />
        </button>
        <MobileBrand />
        {/* Project badge — admin-only dropdown, read-only chip otherwise. */}
        <ProjectPicker user={user} />
      </div>
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

// Feature 4 — the active-project control. Admins get a dropdown listing
// every project (switch = persist my active project). Everyone else just
// sees a read-only "Project · name" chip.
function ProjectPicker({
  user,
}: {
  user: { email: string; role: 'admin' | 'editor' | 'viewer'; project_name?: string | null; projectId?: number } | null;
}) {
  const [open, setOpen] = useState(false);
  const { refetch } = useAuth();
  const projectsQ = useProjects();
  const switchM = useSwitchProject();
  const ref = useRef<HTMLDivElement | null>(null);
  const location = useLocation();

  // Close the menu on route change so a click → navigate doesn't leave the
  // dropdown visually stuck open.
  useEffect(() => setOpen(false), [location.pathname]);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!user) return null;

  const projectName = user.project_name ?? 'Default';
  const isAdmin = user.role === 'admin';

  async function onSwitch(id: number) {
    try {
      await switchM.mutateAsync(id);
      await refetch();
      setOpen(false);
    } catch (_) {
      setOpen(false);
    }
  }

  const activeName =
    isAdmin && projectsQ.data
      ? (projectsQ.data.find((p) => p.id === user.projectId)?.name ?? projectName)
      : projectName;

  return (
    <div ref={ref} className="relative hidden sm:block">
      <button
        type="button"
        data-cy="project-picker"
        data-role={isAdmin ? 'switch' : 'readonly'}
        onClick={() => setOpen((s) => !s)}
        disabled={!isAdmin}
        className="flex items-center gap-1.5 rounded-lg border border-border bg-surface px-2.5 py-1.5 text-xs text-text-secondary transition-colors"
        title="Active project"
      >
        <Icon.Box size={13} className="text-brand" />
        <span data-cy="project-picker-active">{activeName}</span>
        {isAdmin && <Icon.Chevron size={12} className="text-text-tertiary" />}
      </button>
      {isAdmin && open && (
        <div
          role="menu"
          className="absolute left-0 mt-1 w-64 rounded-xl border border-border bg-surface shadow-pop overflow-hidden rg-fade-in"
        >
          <div className="px-4 py-2 border-b border-border-soft text-xs font-medium uppercase tracking-wide text-text-tertiary">
            Active project
          </div>
          <div className="max-h-72 overflow-y-auto py-1">
            {(projectsQ.data ?? []).map((p) => {
              const active = p.id === user.projectId;
              return (
                <button
                  key={p.id}
                  type="button"
                  data-cy="project-picker-option"
                  data-project-id={p.id}
                  onClick={() => onSwitch(p.id)}
                  className="flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm text-text hover:bg-surface-hover transition-colors"
                >
                  <span className="truncate">{p.name}</span>
                  {active && <Icon.Check size={13} className="text-brand" />}
                </button>
              );
            })}
            {!projectsQ.data && <div className="px-4 py-2 text-xs text-text-tertiary">Loading projects…</div>}
          </div>
        </div>
      )}
    </div>
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

  const initials = (email.split('@')[0] ?? '')
    .slice(0, 2)
    .toUpperCase();

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-cy="profile-btn"
        aria-haspopup="menu"
        aria-expanded={open}
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
          aria-label="Account"
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
            role="menuitem"
            data-cy="logout-btn"
            onClick={onLogout}
            className="flex items-center gap-2 w-full px-4 py-2.5 text-left text-sm text-text hover:bg-surface-hover transition-colors focus:outline-none focus:bg-surface-hover"
          >
            <Icon.Logout size={16} />
            Log out
          </button>
        </div>
      )}
    </div>
  );
}
