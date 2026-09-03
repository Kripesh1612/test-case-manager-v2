// API wrapper for the admin page.
//
// User + invite shapes are inferred from the server responses — we
// don't have shared Zod schemas for them yet (only auth + cases +
// suites + scheduler). Adding two tiny Zod schemas would buy us
// runtime validation, but for now we lean on the server's contract
// and TypeScript's structural typing.

import { http } from '@/lib/http';

export interface AdminUser {
  id: number;
  email: string;
  name: string | null;
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
}

export async function fetchUsers(): Promise<AdminUser[]> {
  const { data } = await http.get<{ users: AdminUser[] } | AdminUser[]>('/users');
  // The server returns either a bare array or { users: [...] }; tolerate both.
  if (Array.isArray(data)) return data;
  if ('users' in data && Array.isArray(data.users)) return data.users;
  return [];
}

export async function updateUserRole(id: number, role: AdminUser['role']): Promise<AdminUser> {
  // The server returns the updated user object directly (not wrapped).
  const { data } = await http.put<AdminUser>(`/users/${id}/role`, { role });
  return data;
}

export async function deleteUser(id: number): Promise<void> {
  await http.delete(`/users/${id}`);
}

export async function fetchInvites(): Promise<InviteSummary[]> {
  const { data } = await http.get<{ invites: InviteSummary[] } | InviteSummary[]>('/invites');
  if (Array.isArray(data)) return data;
  if ('invites' in data && Array.isArray(data.invites)) return data.invites;
  return [];
}

export interface InviteSummary {
  id: number;
  email: string;
  role: 'admin' | 'editor' | 'viewer';
  created_at: string;
  expires_at: string | null;
  accepted_at: string | null;
}

export async function createInvite(email: string, role: AdminUser['role']): Promise<InviteSummary> {
  // Server returns the new invite directly.
  const { data } = await http.post<InviteSummary>('/invites', { email, role });
  return data;
}

export async function revokeInvite(id: number): Promise<void> {
  await http.delete(`/invites/${id}`);
}