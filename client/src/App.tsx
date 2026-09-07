// =============================================================================
// App — root router.
//
// Layout strategy:
//   • /invite-redeem is fully public → mounted OUTSIDE <AppShell />.
//   • All other authenticated pages live inside <AppShell />.
//   • <ProtectedRoute /> wraps the inner content so unauthenticated
//     visitors get redirected to /login.
//   • * (NotFound) lives OUTSIDE AppShell so the 404 page is a full-bleed
//     marketing page, not a sidebar shell.
// =============================================================================

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@/components/AppShell';
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
import { AuditLogPage } from '@/features/audit/AuditLogPage';
import { NotFoundPage } from '@/features/misc/NotFoundPage';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
  },
});

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          {/* Public pages — no AppShell. */}
          <Route path="/invite-redeem" element={<InviteRedeemPage />} />

          {/* Everything else sits inside the shell. Auth pages are
              publicly accessible (no token needed) so they bypass
              <ProtectedRoute />. */}
          <Route element={<AppShell />}>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/register" element={<RegisterPage />} />

            <Route element={<ProtectedRoute />}>
              <Route path="/" element={<DashboardPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/cases" element={<CaseListPage />} />
              <Route path="/cases/:id" element={<CaseDetailPage />} />
              <Route path="/suites" element={<SuiteListPage />} />
              <Route path="/suites/:id" element={<SuiteDetailPage />} />
              <Route path="/scheduler" element={<SchedulerPage />} />
              <Route path="/admin" element={<AdminRoute />} />
              <Route path="/admin/audit" element={<AdminRoute><AuditLogPage /></AdminRoute>} />
              <Route path="/trash" element={<TrashPage />} />
            </Route>
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        <ToastHost />
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function AdminRoute({ children }: PropsWithChildren) {
  const { user } = useAuth();
  // Non-admins get redirected to the dashboard. The Cypress RBAC test
  // asserts that the admin tab is hidden for non-admins, and any user
  // who manually types /admin in the URL is bounced.
  if (user && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children ?? <AdminPage />}</>;
}

export default App;
