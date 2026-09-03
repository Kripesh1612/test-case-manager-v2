// Auth state machine.
//
// - `useAuth()` returns `{ user, isLoading, login, logout, register }`.
// - On first mount, we read the token from localStorage and call /me
//   to validate it + load the user. If /me 401s, the http interceptor
//   clears the token and the user stays null.
// - login / register / logout all return promises and update the
//   TanStack Query cache so any component consuming `useAuth()`
//   re-renders immediately.
//
// We deliberately keep `user` shape consistent with what the server
// returns: { id, email, name, role: 'admin' | 'editor' | 'viewer' }.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';

import { http, setToken, clearToken } from '@/lib/http';

export type Role = 'admin' | 'editor' | 'viewer';

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  role: Role;
}

interface AuthResponse {
  user: AuthUser;
  token: string;
}

const ME_KEY = ['auth', 'me'] as const;

async function fetchMe(): Promise<AuthUser> {
  const { data } = await http.get<{ user: AuthUser }>('/auth/me');
  return data.user;
}

export function useAuth() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Token may already exist in localStorage before the component mounts;
  // we still query /me to validate it and load the user. While the
  // query is pending, isLoading is true.
  //
  // We always fire /me. The 401 response just clears the token; it does
  // NOT hard-redirect (the http interceptor used to, but that raced
  // with cy.visit and yanked /invite-redeem visitors to /login
  // mid-render). ProtectedRoute bounces to /login for authenticated
  // pages when user=null; the public auth pages (/login, /register,
  // /invite-redeem) render their own form regardless.
  const me = useQuery({
    queryKey: ME_KEY,
    queryFn: fetchMe,
    retry: false,
    staleTime: 5 * 60_000,
  });

  const login = useMutation({
    mutationFn: async (creds: { email: string; password: string }) => {
      const { data } = await http.post<AuthResponse>('/auth/login', creds);
      return data;
    },
    onSuccess: ({ token, user }) => {
      setToken(token);
      queryClient.setQueryData(ME_KEY, user);
    },
  });

  const register = useMutation({
    mutationFn: async (creds: { email: string; password: string; name?: string }) => {
      const { data } = await http.post<AuthResponse>('/auth/register', creds);
      return data;
    },
    onSuccess: ({ token, user }) => {
      setToken(token);
      queryClient.setQueryData(ME_KEY, user);
    },
  });

  const logout = () => {
    clearToken();
    queryClient.setQueryData(ME_KEY, null);
    queryClient.removeQueries({ queryKey: ME_KEY });
    navigate('/login');
  };

  return {
    user: me.data ?? null,
    isLoading: me.isLoading,
    isAuthenticated: Boolean(me.data),
    login,
    register,
    logout,
    // exposed so components can re-run the /me query if they need to
    refetch: me.refetch,
  };
}