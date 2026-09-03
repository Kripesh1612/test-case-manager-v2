// TanStack Query hooks for the admin page. Users + invites are loaded
// in a single combined query so the table and the side-panel share
// state without two separate network roundtrips. Role updates and user
// deletes optimistically update the cache so the row disappears / the
// role pill changes before the PUT roundtrip completes.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { showToast } from '@/lib/toast';

import { createInvite, deleteUser, fetchInvites, fetchUsers, revokeInvite, updateUserRole, type AdminUser, type InviteSummary } from './api';

interface AdminData {
  users: AdminUser[];
  invites: InviteSummary[];
}

const ADMIN_KEY = ['admin', 'overview'] as const;

async function fetchAdminData(): Promise<AdminData> {
  // /invites is admin-only and 403s for non-admins — but AdminRoute
  // already gated this page, so we're guaranteed admin here. The
  // `.catch` is a defensive fallback in case /invites is unreachable.
  const [users, invites] = await Promise.all([fetchUsers(), fetchInvites().catch(() => [])]);
  return { users, invites };
}

export function useAdminData() {
  // Skip the admin fetch entirely if there's no token — avoids a 401
  // cascade that would otherwise bounce the user out of public pages
  // (e.g. /invite-redeem) when an in-flight /api/users or /api/invites
  // request from a previous /admin mount completes after the URL has
  // changed.
  const hasToken = Boolean(
    typeof window !== 'undefined' && localStorage.getItem('tcm_token'),
  );
  return useQuery({
    queryKey: ADMIN_KEY,
    queryFn: fetchAdminData,
    staleTime: 15_000,
    enabled: hasToken,
  });
}

export function useUpdateRole() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, role }: { id: number; role: AdminUser['role'] }) =>
      updateUserRole(id, role),
    onSuccess: (updated) => {
      qc.setQueryData<AdminData>(ADMIN_KEY, (prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          users: prev.users.map((u) => (u.id === updated.id ? updated : u)),
        };
      });
    },
    onError: (e: unknown) => {
      const msg = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      showToast({ message: msg ?? 'Failed to update role', variant: 'error' });
    },
  });
}

export function useDeleteUser() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteUser(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<AdminData>(ADMIN_KEY, (prev) => {
        if (!prev) return prev;
        return { ...prev, users: prev.users.filter((u) => u.id !== id) };
      });
    },
    onError: (e: unknown) => {
      const msg = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      showToast({ message: msg ?? 'Failed to delete user', variant: 'error' });
    },
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ email, role }: { email: string; role: AdminUser['role'] }) =>
      createInvite(email, role),
    onSuccess: (created) => {
      qc.setQueryData<AdminData>(ADMIN_KEY, (prev) => {
        if (!prev) return prev;
        return { ...prev, invites: [created, ...prev.invites] };
      });
    },
    onError: (e: unknown) => {
      const msg = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      showToast({ message: msg ?? 'Failed to create invite', variant: 'error' });
    },
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => revokeInvite(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<AdminData>(ADMIN_KEY, (prev) => {
        if (!prev) return prev;
        return { ...prev, invites: prev.invites.filter((inv) => inv.id !== id) };
      });
    },
    onError: (e: unknown) => {
      const msg = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      showToast({ message: msg ?? 'Failed to revoke invite', variant: 'error' });
    },
  });
}