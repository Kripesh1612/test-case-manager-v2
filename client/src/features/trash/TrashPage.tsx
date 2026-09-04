// =============================================================================
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
//
// All existing data-cy hooks are preserved verbatim so the UI test
// suite keeps passing without changes.
// =============================================================================

import { useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState, SkeletonRows } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { ConfirmModal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
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
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Trash"
        description="Soft-deleted items are kept here. Restore to bring them back, or purge to remove permanently."
        actions={
          <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1.5 shadow-[var(--shadow-soft)]">
            <Icon.Trash size={14} />
            <span className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
              Trashed
            </span>
            <strong data-cy="trash-total" className="text-sm font-semibold text-text">
              {total}
            </strong>
          </div>
        }
      />

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft text-brand">
              <Icon.Cases size={14} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-text">Test cases</h3>
              <p className="text-xs text-text-secondary">
                {data.cases.length} deleted
              </p>
            </div>
          </div>
        </div>

        {isLoading && data.cases.length === 0 ? (
          <div className="px-5 py-6">
            <SkeletonRows rows={3} />
          </div>
        ) : data.cases.length === 0 ? null : (
          <div className="overflow-x-auto">
            <table data-cy="trash-cases-table" className="w-full text-sm">
              <thead className="bg-surface-sunken text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">ID</th>
                  <th className="px-5 py-2.5 font-medium">Title</th>
                  <th className="px-5 py-2.5 font-medium">Deleted at</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody data-cy="trash-cases-body" className="divide-y divide-border-soft">
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
          </div>
        )}

        {/* Empty-state <p> is always rendered (mirrors the vanilla
            trash.html which kept it in the DOM with `hidden` toggled)
            so cy.get('[data-cy="trash-cases-empty"]') stays queryable. */}
        <div data-cy="trash-cases-empty" hidden={data.cases.length > 0}>
          <EmptyState
            icon={<Icon.Cases size={20} />}
            title="No trashed cases"
            description="Cases you delete will appear here until you restore or purge them."
          />
        </div>
      </Card>

      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-border-soft px-5 py-4">
          <div className="flex items-center gap-2.5">
            <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft text-brand">
              <Icon.Suites size={14} />
            </span>
            <div>
              <h3 className="text-sm font-semibold text-text">Test suites</h3>
              <p className="text-xs text-text-secondary">
                {data.suites.length} deleted
              </p>
            </div>
          </div>
        </div>

        {isLoading && data.suites.length === 0 ? (
          <div className="px-5 py-6">
            <SkeletonRows rows={3} />
          </div>
        ) : data.suites.length === 0 ? null : (
          <div className="overflow-x-auto">
            <table data-cy="trash-suites-table" className="w-full text-sm">
              <thead className="bg-surface-sunken text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">ID</th>
                  <th className="px-5 py-2.5 font-medium">Name</th>
                  <th className="px-5 py-2.5 font-medium">Deleted at</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody data-cy="trash-suites-body" className="divide-y divide-border-soft">
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
          </div>
        )}
        <div data-cy="trash-suites-empty" hidden={data.suites.length > 0}>
          <EmptyState
            icon={<Icon.Suites size={20} />}
            title="No trashed suites"
            description="Suites you delete will appear here until you restore or purge them."
          />
        </div>
      </Card>

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
    </div>
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
    <tr data-cy={`trash-${kind}-row`} className="transition-colors hover:bg-surface-hover">
      <td className="px-5 py-3 text-xs text-text-tertiary">#{row.id}</td>
      <td className="px-5 py-3 font-medium text-text">{label || '(untitled)'}</td>
      <td className="px-5 py-3 text-xs text-text-secondary">
        {row.deleted_at ? new Date(row.deleted_at).toLocaleString() : '—'}
      </td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-cy={`trash-${kind}-restore-btn`}
            leftIcon={<Icon.Restore size={12} />}
            onClick={onRestore}
          >
            Restore
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            data-cy={`trash-${kind}-purge-btn`}
            onClick={onPurge}
            disabled={!isAdmin}
            title={isAdmin ? 'Permanently delete' : 'Admin only'}
          >
            Purge
          </Button>
        </div>
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
