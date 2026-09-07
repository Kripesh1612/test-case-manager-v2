// =============================================================================
// AuditLogPage — admin-only viewer for the audit log (server: /audit).
//
// Renders a filterable, paginated timeline of every recorded mutation.
// Filter controls:
//   - action   (free text, autocomplete from /audit/actions)
//   - actor_id (numeric)
//   - target_type (text)
//   - target_id   (numeric)
//
// Each row shows actor, action, target, IP, and a small JSON dump of
// before/after (collapsed by default to keep the row compact). data-cy
// selectors match what the Cypress UI tests target.
//
// Mounted at /admin/audit by App.tsx. Admin-gated at the server; we
// additionally redirect non-admins client-side (mirrors AdminRoute).
// =============================================================================

import { useMemo, useState } from 'react';

import { Card, SectionHeader } from '@/components/Card';
import { EmptyState, SkeletonRows } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/hooks/useAuth';
import { Navigate } from 'react-router-dom';

import { useAuditActions, useAuditEvents } from './hooks';

const PAGE_SIZE = 50;

export function AuditLogPage() {
  const { user } = useAuth();
  if (user && user.role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  // Filter state. We reset offset whenever a filter changes — pagination
  // is from-the-top with the new constraints.
  const [action, setAction] = useState('');
  const [actorId, setActorId] = useState('');
  const [targetType, setTargetType] = useState('');
  const [targetId, setTargetId] = useState('');
  const [offset, setOffset] = useState(0);

  const filters = useMemo(() => ({
    action: action || undefined,
    actor_id: actorId ? Number(actorId) : undefined,
    target_type: targetType || undefined,
    target_id: targetId ? Number(targetId) : undefined,
    limit: PAGE_SIZE,
    offset,
  }), [action, actorId, targetType, targetId, offset]);

  const { data, isLoading, error } = useAuditEvents(filters);
  const actionsQ = useAuditActions();

  function reset() {
    setAction('');
    setActorId('');
    setTargetType('');
    setTargetId('');
    setOffset(0);
  }

  return (
    <section data-cy="audit-log-page" className="space-y-5">
      <PageHeader
        title="Audit log"
        description="Every mutation recorded by middleware/withAudit. Filter by action, actor, or target."
      />

      <Card>
        <SectionHeader title="Filters" description="Narrow the list; offset resets to 0 on change." />
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-500">Action</span>
            <input
              data-cy="filter-action"
              type="text"
              list="audit-action-list"
              value={action}
              onChange={(e) => { setAction(e.target.value); setOffset(0); }}
              placeholder="e.g. test_case.create"
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
            <datalist id="audit-action-list">
              {(actionsQ.data ?? []).map((a) => <option key={a} value={a} />)}
            </datalist>
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-500">Actor ID</span>
            <input
              data-cy="filter-actor-id"
              type="number"
              min="1"
              value={actorId}
              onChange={(e) => { setActorId(e.target.value); setOffset(0); }}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-500">Target type</span>
            <input
              data-cy="filter-target-type"
              type="text"
              value={targetType}
              onChange={(e) => { setTargetType(e.target.value); setOffset(0); }}
              placeholder="test_case / user / ..."
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-500">Target ID</span>
            <input
              data-cy="filter-target-id"
              type="number"
              min="1"
              value={targetId}
              onChange={(e) => { setTargetId(e.target.value); setOffset(0); }}
              className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm focus:border-blue-500 focus:outline-none"
            />
          </label>

          <div className="flex items-end">
            <button
              type="button"
              data-cy="filter-reset"
              onClick={reset}
              className="rounded border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Reset
            </button>
          </div>
        </div>
      </Card>

      <Card>
        <SectionHeader
          title="Events"
          description={data ? `${data.total.toLocaleString()} matching • showing ${data.events.length}` : 'Loading…'}
          action={
            data && data.total > PAGE_SIZE ? (
              <div className="flex items-center gap-2 text-xs">
                <button
                  type="button"
                  data-cy="audit-prev"
                  disabled={offset === 0}
                  onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
                  className="rounded border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
                >
                  ← Prev
                </button>
                <span className="text-gray-600">
                  {offset + 1}–{Math.min(offset + PAGE_SIZE, data.total)} of {data.total}
                </span>
                <button
                  type="button"
                  data-cy="audit-next"
                  disabled={offset + PAGE_SIZE >= data.total}
                  onClick={() => setOffset(offset + PAGE_SIZE)}
                  className="rounded border border-gray-300 bg-white px-2 py-1 disabled:opacity-50"
                >
                  Next →
                </button>
              </div>
            ) : null
          }
        />

        {error ? (
          <div data-cy="audit-error" className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            Failed to load audit events.
          </div>
        ) : isLoading ? (
          <SkeletonRows rows={6} />
        ) : !data || data.events.length === 0 ? (
          <EmptyState
            title="No audit events match."
            description="Try clearing the filters."
          />
        ) : (
          <ul data-cy="audit-list" className="divide-y divide-gray-100">
            {data.events.map((e) => (
              <li key={e.id} data-cy="audit-row" className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone="info">{e.action}</Pill>
                  <span className="text-xs text-gray-500">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                  {e.actor ? (
                    <span className="text-xs text-gray-700">
                      by <span className="font-medium">{e.actor.email}</span>
                      {e.actor.role ? ` (${e.actor.role})` : ''}
                    </span>
                  ) : (
                    <span className="text-xs italic text-gray-400">system</span>
                  )}
                  {e.target_type ? (
                    <span className="text-xs text-gray-700">
                      → <span className="font-mono">{e.target_type}</span>
                      {e.target_id != null ? ` #${e.target_id}` : ''}
                    </span>
                  ) : null}
                  {e.ip ? (
                    <span className="font-mono text-[11px] text-gray-400">{e.ip}</span>
                  ) : null}
                </div>

                {(e.before != null || e.after != null) && (
                  <details className="mt-1.5">
                    <summary className="cursor-pointer text-[11px] font-medium text-gray-600 hover:text-gray-900">
                      Diff
                    </summary>
                    <div className="mt-1 grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                      <pre className="overflow-auto rounded bg-gray-50 p-2 font-mono leading-snug text-rose-900">
                        {e.before == null ? '(none)' : JSON.stringify(e.before, null, 2)}
                      </pre>
                      <pre className="overflow-auto rounded bg-gray-50 p-2 font-mono leading-snug text-emerald-900">
                        {e.after == null ? '(none)' : JSON.stringify(e.after, null, 2)}
                      </pre>
                    </div>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </section>
  );
}
