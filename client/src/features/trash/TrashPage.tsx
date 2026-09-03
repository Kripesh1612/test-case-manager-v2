// /trash — list soft-deleted cases and suites, with restore + purge.
//
// Auth: any logged-in user can VIEW the trash (the server route guards
// /trash/* with requireAuth only). Restore + purge are admin-only —
// the server returns 403 if a non-admin tries, so we hide the buttons
// for non-admins and rely on the server for the real enforcement.
//
// Data: useTrashData() fans out two parallel GETs into a single
// `{ cases, suites }` shape. Restore / purge mutations invalidate the
// trash query (and the parent cases / suites query where relevant) so
// the lists re-render without a manual refetch.

import { useState } from 'react';

import { ConfirmModal } from '@/components/Modal';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import type { TrashedCase, TrashedSuite } from './api';
import {
  usePurgeCase,
  usePurgeSuite,
  useRestoreCase,
  useRestoreSuite,
  useTrashData,
} from './hooks';

type PendingPurge =
  | { kind: 'case'; id: number; label: string }
  | { kind: 'suite'; id: number; label: string }
  | null;

export function TrashPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const { data, isLoading } = useTrashData();
  const restoreCaseM = useRestoreCase();
  const restoreSuiteM = useRestoreSuite();
  const purgeCaseM = usePurgeCase();
  const purgeSuiteM = usePurgeSuite();

  const [pendingPurge, setPendingPurge] = useState<PendingPurge>(null);

  const total = data.cases.length + data.suites.length;

  async function handleRestoreCase(id: number) {
    try {
      await restoreCaseM.mutateAsync(id);
      showToast({ message: 'Case restored', variant: 'success' });
    } catch (e) {
      showToast({ message: extractError(e, 'Failed to restore case'), variant: 'error' });
    }
  }

  async function handleRestoreSuite(id: number) {
    try {
      await restoreSuiteM.mutateAsync(id);
      showToast({ message: 'Suite restored', variant: 'success' });
    } catch (e) {
      showToast({ message: extractError(e, 'Failed to restore suite'), variant: 'error' });
    }
  }

  async function confirmPurge() {
    if (!pendingPurge) return;
    const target = pendingPurge;
    setPendingPurge(null);
    try {
      if (target.kind === 'case') await purgeCaseM.mutateAsync(target.id);
      else await purgeSuiteM.mutateAsync(target.id);
      showToast({ message: `${target.kind} purged`, variant: 'success' });
    } catch (e) {
      showToast({ message: extractError(e, 'Failed to purge'), variant: 'error' });
    }
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Trash</h2>
          <p className="text-sm text-gray-500">
            Soft-deleted items. Restore to bring them back, or purge to remove permanently.
          </p>
        </div>
        <span className="inline-flex items-center gap-2 rounded border border-gray-200 bg-white px-3 py-1 text-sm">
          <span className="text-xs uppercase text-gray-500">Trashed</span>
          <strong data-cy="trash-total">{total}</strong>
        </span>
      </div>

      <div className="mb-6 rounded border border-gray-200 bg-white">
        <h3 className="border-b border-gray-200 px-4 py-2 text-sm font-semibold">Test Cases</h3>
        {isLoading && data.cases.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">Loading…</div>
        ) : data.cases.length === 0 ? null : (
          <table data-cy="trash-cases-table" className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Title</th>
                <th className="px-3 py-2">Deleted at</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody data-cy="trash-cases-body">
              {data.cases.map((row) => (
                <TrashRow
                  key={row.id}
                  row={row}
                  kind="case"
                  isAdmin={isAdmin}
                  onRestore={() => handleRestoreCase(row.id)}
                  onPurge={() =>
                    setPendingPurge({
                      kind: 'case',
                      id: row.id,
                      label: row.title || '(untitled)',
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        )}
        {/* Empty-state <p> is always rendered (mirrors the vanilla
            trash.html which kept it in the DOM with `hidden` toggled)
            so cy.get('[data-cy="trash-cases-empty"]') stays queryable. */}
        <p
          data-cy="trash-cases-empty"
          hidden={data.cases.length > 0}
          className="px-4 py-6 text-center text-sm text-gray-500"
        >
          No trashed cases.
        </p>
      </div>

      <div className="rounded border border-gray-200 bg-white">
        <h3 className="border-b border-gray-200 px-4 py-2 text-sm font-semibold">Test Suites</h3>
        {isLoading && data.suites.length === 0 ? (
          <div className="px-4 py-6 text-center text-sm text-gray-500">Loading…</div>
        ) : data.suites.length === 0 ? null : (
          <table data-cy="trash-suites-table" className="w-full text-sm">
            <thead className="bg-gray-50 text-left text-xs uppercase text-gray-600">
              <tr>
                <th className="px-3 py-2">ID</th>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2">Deleted at</th>
                <th className="px-3 py-2">Actions</th>
              </tr>
            </thead>
            <tbody data-cy="trash-suites-body">
              {data.suites.map((row) => (
                <TrashRow
                  key={row.id}
                  row={row}
                  kind="suite"
                  isAdmin={isAdmin}
                  onRestore={() => handleRestoreSuite(row.id)}
                  onPurge={() =>
                    setPendingPurge({
                      kind: 'suite',
                      id: row.id,
                      label: row.name || '(untitled)',
                    })
                  }
                />
              ))}
            </tbody>
          </table>
        )}
        <p
          data-cy="trash-suites-empty"
          hidden={data.suites.length > 0}
          className="px-4 py-6 text-center text-sm text-gray-500"
        >
          No trashed suites.
        </p>
      </div>

      {pendingPurge && (
        <ConfirmModal
          title="Purge permanently?"
          message={`Permanently delete this ${pendingPurge.kind}? This cannot be undone.`}
          confirmLabel="Purge"
          danger
          onConfirm={confirmPurge}
          onCancel={() => setPendingPurge(null)}
        />
      )}
    </section>
  );
}

interface TrashRowProps {
  row: TrashedCase | TrashedSuite;
  kind: 'case' | 'suite';
  isAdmin: boolean;
  onRestore: () => void;
  onPurge: () => void;
}

function TrashRow({ row, kind, isAdmin, onRestore, onPurge }: TrashRowProps) {
  const label = kind === 'case'
    ? (row as TrashedCase).title
    : (row as TrashedSuite).name;
  return (
    <tr data-cy={`trash-${kind}-row`}>
      <td className="px-3 py-2">{row.id}</td>
      <td className="px-3 py-2">{label || '(untitled)'}</td>
      <td className="px-3 py-2 text-xs text-gray-600">
        {row.deleted_at ? new Date(row.deleted_at).toLocaleString() : ''}
      </td>
      <td className="px-3 py-2">
        <button
          type="button"
          data-cy={`trash-${kind}-restore-btn`}
          onClick={onRestore}
          className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
        >
          Restore
        </button>
        <button
          type="button"
          data-cy={`trash-${kind}-purge-btn`}
          onClick={onPurge}
          disabled={!isAdmin}
          title={isAdmin ? 'Permanently delete' : 'Admin only'}
          className="ml-2 rounded border border-red-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Purge
        </button>
      </td>
    </tr>
  );
}

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return fallback;
}