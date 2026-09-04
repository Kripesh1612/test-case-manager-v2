// =============================================================================
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
// ui/07-invites.cy.js expect, including the legacy `role-pill.role-*`
// classes and `btn small danger` styles that the index.css still ships.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState, SkeletonRows } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { ConfirmModal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Administration"
        title="Admin"
        description="Manage workspace members and send out invitations."
      />

      {q.error && (
        <div className="flex items-start gap-3 rounded-lg border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <Icon.Warning size={16} />
          <div>
            <strong className="font-semibold">Failed to load</strong>
            <p className="mt-0.5 text-xs opacity-90">
              {(q.error as Error).message}
            </p>
          </div>
        </div>
      )}

      {q.isLoading && (
        <Card className="p-4">
          <SkeletonRows rows={4} />
        </Card>
      )}

      {/* ---------- Users section ---------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text">Users</h2>
            <p className="text-xs text-text-secondary">
              Members of this workspace. Admins can change roles; you can't change your own.
            </p>
          </div>
          <div data-cy="admin-user-total-wrap" className="text-xs text-text-secondary">
            Total: <strong data-cy="admin-user-total" className="text-text">{users.length}</strong>
          </div>
        </div>

        <Card className="p-4">
          <div className="relative flex-1 min-w-[240px]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              <Icon.Search size={14} />
            </span>
            <input
              id="admin-user-search"
              data-cy="admin-user-search"
              type="search"
              value={userSearch}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter by email or name…"
              autoComplete="off"
              className="rg-input pl-9"
            />
          </div>
        </Card>

        <p
          data-cy="admin-user-window-hint"
          className="text-xs text-text-tertiary"
        >
          {usersHint}
        </p>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table
              data-cy="admin-table"
              className="w-full text-sm"
            >
              <thead className="bg-surface-sunken text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">ID</th>
                  <th className="px-5 py-2.5 font-medium">Email</th>
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  <th className="px-5 py-2.5 font-medium">Created</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {displayedUsers.map((u) => {
                  const isSelf = currentUser?.id === u.id;
                  return (
                    <tr
                      key={u.id}
                      data-cy="admin-user-row"
                      data-user-id={u.id}
                      className={`transition-colors hover:bg-surface-hover ${isSelf ? 'row-self bg-brand-soft/40' : ''}`}
                    >
                      <td
                        data-cy="admin-user-id"
                        className="px-5 py-3 text-xs text-text-tertiary"
                      >
                        #{u.id}
                      </td>
                      <td
                        data-cy="admin-user-email"
                        className="px-5 py-3 font-medium text-text"
                      >
                        {u.email}
                      </td>
                      <td
                        data-cy="admin-user-name"
                        className="px-5 py-3 text-text-secondary"
                      >
                        {u.name || '—'}
                      </td>
                      <td data-cy="admin-user-role-cell" className="px-5 py-3">
                        <span className={`role-pill role-${u.role}`}>{u.role}</span>
                        {isSelf && (
                          <span className="you-badge ml-2 inline-flex items-center rounded bg-brand-soft px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-brand-hover">
                            you
                          </span>
                        )}
                      </td>
                      <td
                        data-cy="admin-user-created"
                        className="px-5 py-3 text-xs text-text-secondary"
                      >
                        {new Date(u.created_at).toLocaleDateString()}
                      </td>
                      <td data-cy="admin-user-actions" className="px-5 py-3">
                        <div className="flex items-center justify-end gap-2">
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
                            className="rounded-md border border-border bg-surface px-2 py-1 text-xs text-text focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand-soft"
                          >
                            <option value="admin">admin</option>
                            <option value="editor">editor</option>
                            <option value="viewer">viewer</option>
                          </select>
                          <button
                            type="button"
                            className="btn small danger"
                            data-cy="admin-delete-btn"
                            data-id={u.id}
                            data-action="delete-user"
                            disabled={isSelf}
                            title={isSelf ? 'You cannot delete yourself' : undefined}
                            onClick={() => setPending({ kind: 'delete', user: u })}
                          >
                            Delete
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            data-cy="admin-users-empty"
            style={{ display: displayedUsers.length === 0 ? 'block' : 'none' }}
          >
            <EmptyState
              icon={<Icon.Admin size={20} />}
              title="No users match"
              description="Try clearing the search to see every workspace member."
            />
          </div>
        </Card>
      </section>

      {/* ---------- Invites section ---------- */}
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-text">Invites</h2>
            <p className="text-xs text-text-secondary">
              Outstanding email invites. Revoke to invalidate a token immediately.
            </p>
          </div>
        </div>

        <Card className="p-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
                <Icon.Search size={14} />
              </span>
              <input
                id="invite-search"
                data-cy="invite-search"
                type="search"
                value={inviteSearch}
                onChange={(e) => setInviteSearch(e.target.value)}
                placeholder="Filter invites…"
                autoComplete="off"
                className="rg-input pl-9"
              />
            </div>
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-cy="invite-create-btn"
              leftIcon={<Icon.Plus size={14} />}
              onClick={() => setInviteModal({ open: true, email: '', role: 'viewer', error: null })}
            >
              New invite
            </Button>
          </div>
        </Card>

        <p
          data-cy="invite-window-hint"
          className="text-xs text-text-tertiary"
        >
          {invitesHint}
        </p>

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-surface-sunken text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">ID</th>
                  <th className="px-5 py-2.5 font-medium">Email</th>
                  <th className="px-5 py-2.5 font-medium">Role</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Expires</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody data-cy="invite-table-body" className="divide-y divide-border-soft">
                {displayedInvites.map((inv) => {
                  const expired = inv.expires_at !== null && new Date(inv.expires_at) < new Date();
                  const status = inv.accepted_at ? 'accepted' : expired ? 'expired' : 'pending';
                  return (
                    <tr
                      key={inv.id}
                      data-cy="invite-row"
                      data-invite-id={inv.id}
                      className="transition-colors hover:bg-surface-hover"
                    >
                      <td className="px-5 py-3 text-xs text-text-tertiary">#{inv.id}</td>
                      <td className="px-5 py-3 font-medium text-text">{inv.email}</td>
                      <td className="px-5 py-3">
                        <span className={`role-pill role-${inv.role}`}>{inv.role}</span>
                      </td>
                      <td className="px-5 py-3">
                        <span className={`role-pill role-${status}`}>{status}</span>
                      </td>
                      <td className="px-5 py-3 text-xs text-text-secondary">
                        {inv.expires_at ? new Date(inv.expires_at).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-5 py-3">
                        <div className="flex items-center justify-end">
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
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div
            data-cy="invite-table-empty"
            style={{ display: displayedInvites.length === 0 ? 'block' : 'none' }}
          >
            <EmptyState
              icon={<Icon.Mail size={20} />}
              title="No invites match"
              description="Try clearing the filter or send a new invite."
            />
          </div>
        </Card>
      </section>

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
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        style={{ display: inviteModal.open ? 'flex' : 'none' }}
        onClick={() => setInviteModal((s) => ({ ...s, open: false }))}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-[var(--shadow-pop)]"
          role="dialog"
          aria-modal="true"
        >
          <div className="mb-4 flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
              <Icon.Mail size={16} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-text">Create invite</h3>
              <p className="mt-0.5 text-xs text-text-secondary">
                Send a single-use invite token by email.
              </p>
            </div>
          </div>

          {inviteModal.error && (
            <div
              data-cy="invite-modal-error"
              className="mb-3 flex items-start gap-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger-text"
            >
              <Icon.Warning size={14} />
              <span>{inviteModal.error}</span>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="invite-email" className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Email
              </label>
              <input
                id="invite-email"
                data-cy="invite-email-input"
                type="email"
                autoComplete="off"
                value={inviteModal.email}
                onChange={(e) =>
                  setInviteModal((s) => ({ ...s, email: e.target.value, error: null }))
                }
                className="rg-input"
                placeholder="teammate@example.com"
              />
            </div>

            <div>
              <label htmlFor="invite-role" className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Role
              </label>
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
                className="rg-input"
              >
                <option value="admin">admin</option>
                <option value="editor">editor</option>
                <option value="viewer">viewer</option>
              </select>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              data-cy="invite-modal-cancel"
              onClick={() => setInviteModal((s) => ({ ...s, open: false }))}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              data-cy="invite-modal-confirm"
              onClick={submitInviteModal}
              loading={createInviteM.isPending}
              leftIcon={<Icon.Mail size={14} />}
            >
              {createInviteM.isPending ? 'Creating…' : 'Create invite'}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
