// Route wrapper that gates access to authenticated users.
//
// - While /me is loading: render a minimal placeholder so we don't
//   flash the login page for users who already have a valid token.
// - When /me resolves to null (no token, or 401'd): redirect to
//   /login, preserving the intended destination so the login page
//   can return the user there afterwards.

import { Navigate, Outlet, useLocation } from 'react-router-dom';

import { useAuth } from '@/hooks/useAuth';

export function ProtectedRoute() {
  const { user, isLoading } = useAuth();
  const location = useLocation();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-500">
        Loading…
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }

  return <Outlet />;
}