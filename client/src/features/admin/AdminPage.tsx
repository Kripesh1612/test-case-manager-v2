// /admin — admin-only user + invite management.
//
// Reproduces the public/admin.html + public/admin.js UX with React:
//   - users table capped at 10 rows (windowed, latest first,
//     admins always on top)
//   - users search box filters by email / name substring
//   - per-row role <select> opens a confirm modal before PUT
//   - per-row Delete button opens a confirm modal before DELETE
//   - self row's controls are disabled
//   - invites table (10 rows windowed, latest first) with search
//   - invite create modal (exposed on window.__inviteModal.show so the
//     Cypress test can bypass the button click that gets re-covered by
//     the modal backdrop — same trick as the vanilla admin.js)
//
// The data-cy contract matches what ui/05-admin.cy.js and
// ui/07-invites.cy.js expect.

import { useEffect, useMemo, useState } from 'react';

import { ConfirmModal } from '@/components/Modal';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import type { AdminUser as AdminUserData, InviteSummary } from './api';
import {
  useAdminData,
  useCreateInvite,
  useDeleteUser,
  useRevokeInvite,
  useUpdateRole,
} from './hooks';

const WINDOW_SIZE = 10;

type Pending =
  | { kind: 'role'; user: AdminUserData; nextRole: AdminUserData['role'] }
  | { kind: 'delete'; user: AdminUserData }
  | { kind: 'revoke'; invite: InviteSummary }
  | null;

interface InviteModalState {
  open: boolean;
  email: string;
  role: AdminUserData['role'];
  error: string | null;
}

export function AdminPage() {
  const { user: currentUser } = useAuth();
  const q = useAdminData();
  const updateM = useUpdateRole();
  const deleteM = useDeleteUser();
  const createInviteM = useCreateInvite();
  const revokeInviteM = useRevokeInvite();
  const [userSearch, setSearch] = useState('');
  const [inviteSearch, setInviteSearch] = useState('');
  const [pending, setPending] = useState<Pending>(null);
  const [inviteModal, setInviteModal] = useState<InviteModalState>({
    open: false,
    email: '',
    role: 'viewer',
    error: null,
  });

  const users = q.data?.users ?? [];
  const invites = q.data?.invites ?? [];

  // ---------- Users table ----------
  const filteredUsers = useMemo(() => {
    const needle = userSearch.trim().toLowerCase();
    if (!needle) return users;
    return users.filter(
      (u) =>
        u.email.toLowerCase().includes(needle) ||
        (u.name ?? '').toLowerCase().includes(needle),
    );
  }, [users, userSearch]);

  const displayedUsers = useMemo(() => {
    return [...filteredUsers]
      .sort((a, b) => {
        const aAdmin = a.role === 'admin' ? 0 : 1;
        const bAdmin = b.role === 'admin' ? 0 : 1;
        if (aAdmin !== bAdmin) return aAdmin - bAdmin;
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      })
      .slice(0, WINDOW_SIZE);
  }, [filteredUsers]);

  const usersHint =
    filteredUsers.length > displayedUsers.length
      ? `Showing ${displayedUsers.length} of ${filteredUsers.length} (latest first)`
      : `Showing ${displayedUsers.length} of ${users.length}`;

  // ---------- Invites table ----------
  const filteredInvites = useMemo(() => {
    const needle = inviteSearch.trim().toLowerCase();
    if (!needle) return invites;
    return invites.filter((inv) => {
      const expired = inv.expires_at !== null && new Date(inv.expires_at) < new Date();
      const status = inv.accepted_at ? 'accepted' : expired ? 'expired' : 'pending';
      return (
        inv.email.toLowerCase().includes(needle) ||
        (inv.role || '').toLowerCase().includes(needle) ||
        status.includes(needle)
      );
    });
  }, [invites, inviteSearch]);

  const displayedInvites = useMemo(() => {
    return [...filteredInvites]
      .sort((a, b) => {
        const dt = new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
        return dt !== 0 ? dt : b.id - a.id;
      })
      .slice(0, WINDOW_SIZE);
  }, [filteredInvites]);

  const invitesHint =
    filteredInvites.length > displayedInvites.length
      ? `Showing ${displayedInvites.length} of ${filteredInvites.length} (latest first)`
      : `Showing ${displayedInvites.length} of ${invites.length}`;

  // ---------- Expose window.__inviteModal for Cypress ----------
  // The vanilla admin.js attached `__inviteModal.show` to window so the
  // spec could bypass the click that gets re-covered by the modal
  // backdrop. We do the same here.
  useEffect(() => {
    (window as unknown as { __inviteModal?: { show: () => void; hide: () => void } }).__inviteModal = {
      show: () => setInviteModal({ open: true, email: '', role: 'viewer', error: null }),
      hide: () => setInviteModal((s) => ({ ...s, open: false })),
    };
    return () => {
      delete (window as unknown as { __inviteModal?: unknown }).__inviteModal;
    };
  }, []);

  // ---------- Confirm handler ----------
  async function confirmPending() {
    if (!pending) return;
    if (pending.kind === 'role') {
      const { user, nextRole } = pending;
      setPending(null);
      try {
        await updateM.mutateAsync({ id: user.id, role: nextRole });
        showToast({ message: `Role updated to ${nextRole}`, variant: 'success' });
      } catch {
        // surface handled in useUpdateRole.onError
      }
    } else if (pending.kind === 'delete') {
      const { user } = pending;
      setPending(null);
      try {
        await deleteM.mutateAsync(user.id);
        showToast({ message: 'User deleted', variant: 'success' });
      } catch {
        // surface handled in useDeleteUser.onError
      }
    } else {
      const { invite } = pending;
      setPending(null);
      try {
        await revokeInviteM.mutateAsync(invite.id);
        showToast({ message: 'Invite revoked', variant: 'success' });
      } catch {
        // surface handled in useRevokeInvite.onError
      }
    }
  }

  // ---------- Invite create handler ----------
  async function submitInviteModal() {
    const email = inviteModal.email.trim();
    if (!email) {
      setInviteModal((s) => ({ ...s, error: 'Email is required' }));
      return;
    }
    try {
      await createInviteM.mutateAsync({ email, role: inviteModal.role });
      setInviteModal({ open: false, email: '', role: 'viewer', error: null });
      showToast({ message: `Invite created for ${email}`, variant: 'success' });
    } catch (e) {
      const msg = e && typeof e === 'object' && 'response' in e
        ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
        : null;
      setInviteModal((s) => ({ ...s, error: msg ?? 'Failed to create invite' }));
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Admin</h2>
          <p className="text-sm text-gray-500">
            Manage users and their roles
          </p>
        </div>
      </div>

      {q.isLoading && (
        <div className="py-6 text-center text-sm text-gray-500">Loading…</div>
      )}

      {q.error && (
        <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
          Failed to load: {(q.error as Error).message}
        </div>
      )}

      {/* ---------- Users section ---------- */}
      <div className="mb-3 flex flex-wrap items-center gap-3 rounded border border-gray-200 bg-white p-3">
        <label htmlFor="admin-user-search" className="text-sm font-medium">
          Search users
        </label>
        <input
          id="admin-user-search"
          data-cy="admin-user-search"
          type="search"
          value={userSearch}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filter by email or name…"
          autoComplete="off"
          className="min-w-[200px] flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
        <div data-cy="admin-user-total-wrap" className="text-xs text-gray-500">
          Total:{' '}
          <strong data-cy="admin-user-total">{users.length}</strong>
        </div>
      </div>

      <p
        data-cy="admin-user-window-hint"
        className="mb-2 text-xs text-gray-500"
      >
        {usersHint}
      </p>

      <table
        data-cy="admin-table"
        className="mb-8 w-full table-auto border-collapse rounded border border-gray-200 bg-white text-sm"
      >
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left">ID</th>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-left">Name</th>
            <th className="px-3 py-2 text-left">Role</th>
            <th className="px-3 py-2 text-left">Created</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody>
          {displayedUsers.map((u) => {
            const isSelf = currentUser?.id === u.id;
            return (
              <tr
                key={u.id}
                data-cy="admin-user-row"
                data-user-id={u.id}
                className={isSelf ? 'row-self' : ''}
              >
                <td data-cy="admin-user-id" className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                  {u.id}
                </td>
                <td data-cy="admin-user-email" className="border-t border-gray-100 px-3 py-2">
                  {u.email}
                </td>
                <td data-cy="admin-user-name" className="border-t border-gray-100 px-3 py-2">
                  {u.name || '—'}
                </td>
                <td data-cy="admin-user-role-cell" className="border-t border-gray-100 px-3 py-2">
                  <span className={`role-pill role-${u.role}`}>{u.role}</span>
                  {isSelf && (
                    <span className="you-badge ml-2 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-medium uppercase text-blue-700">
                      you
                    </span>
                  )}
                </td>
                <td data-cy="admin-user-created" className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                  {new Date(u.created_at).toLocaleDateString()}
                </td>
                <td data-cy="admin-user-actions" className="border-t border-gray-100 px-3 py-2">
                  <select
                    data-cy="admin-role-select"
                    data-id={u.id}
                    disabled={isSelf}
                    title={isSelf ? 'You cannot change your own role' : undefined}
                    value={u.role}
                    onChange={(e) => {
                      const nextRole = e.target.value as AdminUserData['role'];
                      if (nextRole === u.role) return;
                      setPending({ kind: 'role', user: u, nextRole });
                    }}
                    className="rounded border border-gray-300 px-1 py-0.5 text-xs"
                  >
                    <option value="admin">admin</option>
                    <option value="editor">editor</option>
                    <option value="viewer">viewer</option>
                  </select>
                  <button
                    type="button"
                    className="btn small danger ml-2"
                    data-cy="admin-delete-btn"
                    data-id={u.id}
                    data-action="delete-user"
                    disabled={isSelf}
                    title={isSelf ? 'You cannot delete yourself' : undefined}
                    onClick={() => setPending({ kind: 'delete', user: u })}
                  >
                    Delete
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div
        data-cy="admin-users-empty"
        className="py-6 text-center text-sm text-gray-500"
        style={{ display: displayedUsers.length === 0 ? 'block' : 'none' }}
      >
        No users match the current filters.
      </div>

      {/* ---------- Invites section ---------- */}
      <div className="mt-8 mb-3 flex flex-wrap items-center gap-3 rounded border border-gray-200 bg-white p-3">
        <h3 className="text-base font-semibold">Invites</h3>
        <input
          id="invite-search"
          data-cy="invite-search"
          type="search"
          value={inviteSearch}
          onChange={(e) => setInviteSearch(e.target.value)}
          placeholder="Filter invites…"
          autoComplete="off"
          className="min-w-[200px] flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
        />
        <button
          type="button"
          data-cy="invite-create-btn"
          onClick={() => setInviteModal({ open: true, email: '', role: 'viewer', error: null })}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New Invite
        </button>
      </div>

      <p
        data-cy="invite-window-hint"
        className="mb-2 text-xs text-gray-500"
      >
        {invitesHint}
      </p>

      <table className="w-full table-auto border-collapse rounded border border-gray-200 bg-white text-sm">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-3 py-2 text-left">ID</th>
            <th className="px-3 py-2 text-left">Email</th>
            <th className="px-3 py-2 text-left">Role</th>
            <th className="px-3 py-2 text-left">Status</th>
            <th className="px-3 py-2 text-left">Expires</th>
            <th className="px-3 py-2 text-left">Actions</th>
          </tr>
        </thead>
        <tbody data-cy="invite-table-body">
          {displayedInvites.map((inv) => {
            const expired = inv.expires_at !== null && new Date(inv.expires_at) < new Date();
            const status = inv.accepted_at ? 'accepted' : expired ? 'expired' : 'pending';
            return (
              <tr key={inv.id} data-cy="invite-row" data-invite-id={inv.id}>
                <td className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">{inv.id}</td>
                <td className="border-t border-gray-100 px-3 py-2">{inv.email}</td>
                <td className="border-t border-gray-100 px-3 py-2">{inv.role}</td>
                <td className="border-t border-gray-100 px-3 py-2">
                  <span className={`role-pill role-${status}`}>{status}</span>
                </td>
                <td className="border-t border-gray-100 px-3 py-2 text-xs text-gray-500">
                  {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : '—'}
                </td>
                <td className="border-t border-gray-100 px-3 py-2">
                  <button
                    type="button"
                    className="btn small danger"
                    data-cy="invite-revoke-btn"
                    data-id={inv.id}
                    disabled={Boolean(inv.accepted_at)}
                    title={inv.accepted_at ? 'Already accepted' : undefined}
                    onClick={() => setPending({ kind: 'revoke', invite: inv })}
                  >
                    Revoke
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div
        data-cy="invite-table-empty"
        className="py-6 text-center text-sm text-gray-500"
        style={{ display: displayedInvites.length === 0 ? 'block' : 'none' }}
      >
        No invites match the current filters.
      </div>

      {/* ---------- Modals ---------- */}
      {pending && pending.kind === 'role' && (
        <ConfirmModal
          title="Change user role?"
          message={`Set ${pending.user.email} to "${pending.nextRole}". Their next request will use the new role.`}
          confirmLabel="Change role"
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}

      {pending && pending.kind === 'delete' && (
        <ConfirmModal
          title="Delete user?"
          message={`${pending.user.email} will be permanently removed. This cannot be undone.`}
          confirmLabel="Delete user"
          danger
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}

      {pending && pending.kind === 'revoke' && (
        <ConfirmModal
          title="Revoke invite?"
          message="The token will no longer be usable."
          confirmLabel="Revoke"
          danger
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}

      {/* Modal is always rendered so Cypress's
          `cy.get('[data-cy="invite-modal"]').should('not.be.visible')`
          can find it after close. Hidden via CSS when not open. */}
      <div
        data-cy="invite-modal"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
        style={{ display: inviteModal.open ? 'flex' : 'none' }}
        onClick={() => setInviteModal((s) => ({ ...s, open: false }))}
      >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm rounded bg-white p-5 shadow-xl"
          >
            <h3 className="mb-2 text-base font-semibold">Create invite</h3>
            {inviteModal.error && (
              <p
                data-cy="invite-modal-error"
                className="mb-2 text-xs text-red-600"
              >
                {inviteModal.error}
              </p>
            )}
            <label className="mb-1 block text-sm font-medium">Email</label>
            <input
              id="invite-email"
              data-cy="invite-email-input"
              type="email"
              autoComplete="off"
              value={inviteModal.email}
              onChange={(e) =>
                setInviteModal((s) => ({ ...s, email: e.target.value, error: null }))
              }
              className="mb-3 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            />
            <label className="mb-1 block text-sm font-medium">Role</label>
            <select
              id="invite-role"
              data-cy="invite-role-select"
              value={inviteModal.role}
              onChange={(e) =>
                setInviteModal((s) => ({
                  ...s,
                  role: e.target.value as AdminUserData['role'],
                }))
              }
              className="mb-4 w-full rounded border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="admin">admin</option>
              <option value="editor">editor</option>
              <option value="viewer">viewer</option>
            </select>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                data-cy="invite-modal-cancel"
                onClick={() => setInviteModal((s) => ({ ...s, open: false }))}
                className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                data-cy="invite-modal-confirm"
                onClick={submitInviteModal}
                disabled={createInviteM.isPending}
                className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {createInviteM.isPending ? 'Creating…' : 'Create'}
              </button>
            </div>
          </div>
      </div>
    </section>
  );
}