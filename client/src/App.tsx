import { useEffect, useRef, useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Link, NavLink, Outlet, Route, Routes } from 'react-router-dom';

import { ProtectedRoute } from '@/components/ProtectedRoute';
import { ToastHost } from '@/components/ToastHost';
import { useAuth } from '@/hooks/useAuth';
import { LoginPage } from '@/features/auth/LoginPage';
import { RegisterPage } from '@/features/auth/RegisterPage';
import { CaseListPage } from '@/features/cases/CaseListPage';
import { CaseDetailPage } from '@/features/cases/CaseDetailPage';
import { AdminPage } from '@/features/admin/AdminPage';
import { InviteRedeemPage } from '@/features/invites/InviteRedeemPage';
import { TrashPage } from '@/features/trash/TrashPage';
import { DashboardPage } from '@/features/dashboard/DashboardPage';
import { SuiteListPage } from '@/features/suites/SuiteListPage';
import { SuiteDetailPage } from '@/features/suites/SuiteDetailPage';
import { SchedulerPage } from '@/features/scheduler/SchedulerPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        {/* /invite-redeem is a fully-public page (it issues the JWT for
            users who don't have one yet). We mount it OUTSIDE <Shell />
            and use a path-relative layout route for Shell. Shell's
            children are the explicit paths only — no catch-all — so the
            layout route's children never match /invite-redeem, which
            means Shell's useAuth() /me check doesn't fire when an
            invitee lands there. The top-level catch-all (NotFound) also
            lives OUTSIDE Shell for the same reason.
            /
            The root path "/" is wrapped in <ProtectedRoute /> so an
            unauthenticated visitor is bounced to /login (mirroring the
            vanilla index.html behaviour where landing on the home URL
            redirected to the login screen). /dashboard re-uses the same
            Home component for the post-login landing page. */}
        <Routes>
          <Route path="/invite-redeem" element={<InviteRedeemPage />} />
          <Route element={<Shell />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />
            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<Home />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/cases" element={<CaseListPage />} />
              <Route path="/cases/:id" element={<CaseDetailPage />} />
              <Route path="/suites" element={<SuiteListPage />} />
              <Route path="/suites/:id" element={<SuiteDetailPage />} />
              <Route path="/admin" element={<AdminRoute />} />
              <Route path="/scheduler" element={<SchedulerPage />} />
              <Route path="/trash" element={<TrashPage />} />
            </Route>
          </Route>
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function Shell() {
  const { user, logout } = useAuth();
  return (
    <div
      // The vanilla admin.js adds `role-viewer` to <body> to hide write
      // controls via CSS. The Cypress RBAC test (`viewer sees a
      // read-only banner and no New buttons`) checks that the new-test
      // button is `not.be.visible` for viewers — we expose the same
      // hook via a body data-attribute and a CSS rule in index.css.
      className={`min-h-screen bg-gray-50 text-gray-900 ${user ? `role-${user.role}` : ''}`}
      data-user-role={user?.role ?? ''}
    >
      <header className="border-b bg-white px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center justify-between">
          <Link to="/" className="text-xl font-semibold">
            Test Case Manager
          </Link>
          {user && (
            <nav className="flex items-center gap-4 text-sm">
              <NavLink
                to="/dashboard"
                data-cy="tab-dashboard"
                className="text-gray-700 hover:text-blue-600"
              >
                Dashboard
              </NavLink>
              <NavLink
                to="/cases"
                data-cy="tab-cases"
                className="text-gray-700 hover:text-blue-600"
              >
                Cases
              </NavLink>
              <NavLink
                to="/suites"
                data-cy="tab-suites"
                className="text-gray-700 hover:text-blue-600"
              >
                Suites
              </NavLink>
              <NavLink
                to="/scheduler"
                data-cy="tab-scheduler"
                className="text-gray-700 hover:text-blue-600"
              >
                Scheduler
              </NavLink>
              {/* Admin tab is always rendered; the `hidden` attribute
                  mirrors the vanilla setupProfileMenu behaviour so
                  Cypress's `cy.get('[data-cy="tab-admin"]').should(
                  'not.be.visible')` (which requires the element to
                  exist) keeps passing for editors / non-admins. */}
              <NavLink
                to="/admin"
                data-cy="tab-admin"
                hidden={user.role !== 'admin'}
                className="text-gray-700 hover:text-blue-600"
              >
                Admin
              </NavLink>
              {/* Trash tab mirrors the vanilla per-page <nav class="tabs">:
                  always rendered so cy.get('[data-cy="tab-trash"]') can
                  find it, `active` class added when on /trash so the
                  existing "tab is visible + active" assertion keeps
                  passing. */}
              <NavLink
                to="/trash"
                data-cy="tab-trash"
                className={({ isActive }) =>
                  `text-gray-700 hover:text-blue-600${isActive ? ' active' : ''}`
                }
              >
                Trash
              </NavLink>
              <ProfileMenu email={user.email} role={user.role} onLogout={logout} />
            </nav>
          )}
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">
        <Outlet />
      </main>
      <ToastHost />
    </div>
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

  // Close on outside click + Escape, matching the vanilla admin.js
  // `setupProfileMenu` semantics.
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

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-cy="profile-btn"
        onClick={() => setOpen((s) => !s)}
        className="flex items-center gap-2 rounded border border-gray-300 px-3 py-1 text-xs hover:bg-gray-50"
      >
        <span>{email}</span>
        <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] uppercase">{role}</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 rounded border border-gray-200 bg-white py-2 shadow-lg"
        >
          <div className="px-3 py-2 text-xs text-gray-500">Signed in as</div>
          <div className="px-3 pb-2 text-sm font-medium">{email}</div>
          <div className="border-t border-gray-100" />
          <div className="px-3 py-2 text-xs">
            Role:{' '}
            <span data-cy="profile-role-admin" className={`role-pill role-${role}`}>
              {role}
            </span>
          </div>
          <button
            type="button"
            data-cy="logout-btn"
            onClick={onLogout}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-gray-50"
          >
            Log out
          </button>
        </div>
      )}
    </div>
  );
}

function AdminRoute() {
  const { user } = useAuth();
  if (!user) return null;
  if (user.role !== 'admin') {
    // Mirror the vanilla admin.js: bounce non-admins to /dashboard.
    return <NavigateTo to="/dashboard" />;
  }
  return <AdminPage />;
}

function NavigateTo({ to }: { to: string }) {
  // Cheap imperative redirect via window.location so it happens after
  // the current render frame (matching the vanilla `setTimeout` 800ms
  // delay is intentionally dropped — the test wants to land on
  // /dashboard promptly).
  window.location.replace(to);
  return null;
}

function Home() {
  const { user } = useAuth();
  return (
    <section>
      <h2 className="mb-2 text-2xl font-semibold">Welcome{user ? `, ${user.email}` : ''}</h2>
      <p className="text-gray-600">
        Phase 5: React + Vite + TS + Tailwind + Router + Query + auth + admin.
      </p>
      <ul className="mt-4 list-disc pl-5 text-sm text-gray-700">
        <li>Token persists in <code className="rounded bg-gray-100 px-1">localStorage.tcm_token</code></li>
        <li>401 responses auto-redirect to /login (unless already on an auth page)</li>
        <li>Forms validated client-side via the shared Zod schemas</li>
        <li>Server-side validation is the same source of truth</li>
      </ul>
    </section>
  );
}

function NotFound() {
  return (
    <section>
      <h2 className="mb-2 text-2xl font-semibold">Not found</h2>
      <p className="text-gray-600">No route matches this URL.</p>
    </section>
  );
}

export default App;