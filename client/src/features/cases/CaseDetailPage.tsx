// CaseDetailPage — read-only view of a single test case + version history.
//
// Layout:
//   1. Breadcrumb + header card with title, status/priority pills, and meta
//   2. Two-column body: left = timeline-style version list, right =
//      either a side-by-side diff view or a single-snapshot view
//   3. Restore button (admin/editor only) per older version with confirm modal
//
// URL state:
//   ?from=<versionId>           → single snapshot of that version
//   ?from=<v1>&to=<v2>          → diff between two versions
//   absent / cleared             → falls back to "newest vs previous" diff
//                                  when there are 2+ versions, else newest
//                                  snapshot, else empty state.

import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { ConfirmModal } from '@/components/Modal';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import { CaseDiffView } from './CaseDiffView';
import { FlakinessPanel } from './FlakinessComponents';
import { RunPanel } from './RunPanel';
import { useCase, useCaseDiff, useRestoreVersion, useVersion, useVersions } from './hooks';

export function CaseDetailPage() {
  const { id } = useParams<{ id: string }>();
  const caseId = Number(id);
  const [params, setParams] = useSearchParams();
  const { user } = useAuth();

  const caseQ = useCase(caseId);
  const versionsQ = useVersions(caseId);

  const rawFrom = params.get('from');
  const rawTo = params.get('to');
  const fromId = rawFrom == null ? NaN : Number(rawFrom);
  const toId = rawTo == null ? NaN : Number(rawTo);
  const hasValidDiff = Number.isFinite(fromId) && Number.isFinite(toId) && fromId !== toId;

  const versionQ = useVersion(caseId, hasValidDiff ? 0 : (fromId || 0));
  const diffQ = useCaseDiff(caseId, fromId, toId);

  const restoreM = useRestoreVersion(caseId);
  const [pendingRestore, setPendingRestore] = useState<number | null>(null);

  // On first load with no selection, default to "current vs previous"
  // so the user lands on a meaningful diff.
  useEffect(() => {
    if (!versionsQ.data || versionsQ.data.length < 2) return;
    if (params.has('from') || params.has('to')) return;
    const newest = versionsQ.data[0];
    const previous = versionsQ.data[1];
    if (!newest || !previous) return;
    const next = new URLSearchParams(params);
    next.set('from', String(previous.id));
    next.set('to', String(newest.id));
    setParams(next, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versionsQ.data?.length, caseId]);

  if (caseQ.isLoading || versionsQ.isLoading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-gray-500">
        <svg className="-ml-1 mr-2 h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        Loading case…
      </div>
    );
  }

  if (caseQ.error || !caseQ.data) {
    return (
      <div className="rounded-lg border border-red-200 bg-red-50 p-6 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-red-100 text-red-600">
          <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="text-sm font-medium text-red-900">Test case not found</div>
        <div className="mt-1 text-xs text-red-700">It may have been deleted.</div>
        <Link
          to="/cases"
          data-cy="case-detail-back"
          className="mt-4 inline-block rounded-md border border-red-200 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50"
        >
          ← Back to all cases
        </Link>
      </div>
    );
  }

  const tc = caseQ.data;
  const versions = versionsQ.data ?? [];
  const status = tc.status ?? 'draft';
  const priority = tc.priority ?? 'medium';

  function selectVersion(versionId: number) {
    const next = new URLSearchParams(params);
    const currentFrom = params.get('from') == null ? NaN : Number(params.get('from'));
    const currentTo = params.get('to') == null ? NaN : Number(params.get('to'));

    if (!Number.isFinite(currentFrom) && !Number.isFinite(currentTo)) {
      next.set('from', String(versionId));
    } else if (Number.isFinite(currentFrom) && !Number.isFinite(currentTo)) {
      next.set('to', String(versionId));
    } else {
      next.delete('from');
      next.delete('to');
      next.set('from', String(versionId));
    }
    setParams(next, { replace: true });
  }

  function clearSelection() {
    const next = new URLSearchParams(params);
    next.delete('from');
    next.delete('to');
    const newest = versionsQ.data?.[0];
    if (newest) next.set('from', String(newest.id));
    setParams(next, { replace: true });
  }

  async function confirmRestore() {
    if (pendingRestore == null) return;
    const id = pendingRestore;
    setPendingRestore(null);
    try {
      await restoreM.mutateAsync(id);
      showToast({
        message: `Restored from version ${versions.find((v) => v.id === id)?.version ?? ''}`,
        variant: 'success',
      });
      clearSelection();
    } catch (e) {
      const msg = extractError(e, 'Failed to restore version');
      showToast({ message: msg, variant: 'error' });
    }
  }

  const canRestore = user?.role === 'admin' || user?.role === 'editor';
  const pendingRestoreVersion = pendingRestore != null ? versions.find((v) => v.id === pendingRestore) : null;

  return (
    <section data-cy="case-detail-page" className="space-y-5">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs">
        <Link
          to="/cases"
          data-cy="case-detail-back"
          className="flex items-center gap-1 text-gray-500 hover:text-gray-700"
        >
          <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M9.707 14.707a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 1.414L7.414 9H17a1 1 0 110 2H7.414l2.293 2.293a1 1 0 010 1.414z" clipRule="evenodd" />
          </svg>
          All cases
        </Link>
        <span className="text-gray-300">/</span>
        <span className="text-gray-500">Case #{tc.id}</span>
      </nav>

      {/* Header card */}
      <header className="rounded-lg border border-gray-200 bg-white px-6 py-5 shadow-sm">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-gray-500">
              <span className="rounded bg-gray-100 px-2 py-0.5">Test Case</span>
              <span>#{tc.id}</span>
            </div>
            <h2
              data-cy="case-detail-title"
              className="mt-1 break-words text-2xl font-semibold tracking-tight text-gray-900"
            >
              {tc.title}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Pill kind="status" value={status} data-cy="case-detail-status" />
              <Pill kind="priority" value={priority} data-cy="case-detail-priority" />
              <span
                data-cy="case-detail-version-count"
                className="inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-700"
              >
                <svg className="h-3 w-3 text-gray-400" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-11a1 1 0 10-2 0v3.586L7.707 13.879a1 1 0 101.414 1.414L11 12.414V14a1 1 0 102 0v-3a1 1 0 00-.293-.707l-2-2A1 1 0 0010 7z" clipRule="evenodd" />
                </svg>
                {versions.length} version{versions.length === 1 ? '' : 's'}
              </span>
              {tc.tags && tc.tags.length > 0 && (
                <div className="flex flex-wrap items-center gap-1">
                  {tc.tags.map((tag) => (
                    <span
                      key={tag}
                      className="inline-flex items-center rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-700"
                    >
                      #{tag}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <Link
            to={`/cases?edit=${tc.id}`}
            data-cy="case-edit-btn"
            data-writable="true"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
            </svg>
            Edit
          </Link>
        </div>
      </header>

      {/* Two-column body */}
      <FlakinessPanel caseId={caseId} />

      {/* Phase 8 — Cypress execution sits beside the flakiness panel so
          both can react to the same case data. Both are full-width to
          keep the layout readable on narrow viewports; the two-column
          diff grid (below) is the only place where horizontal space is
          split. */}
      <RunPanel caseData={tc} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        {/* Version history timeline */}
        <aside className="space-y-3" data-cy="case-version-list">
          <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-white px-4 py-2.5">
            <div className="flex items-center gap-2">
              <svg className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
              </svg>
              <h3 className="text-sm font-semibold text-gray-900">Version history</h3>
            </div>
            {hasValidDiff && (
              <button
                type="button"
                data-cy="case-diff-clear"
                onClick={clearSelection}
                className="rounded text-xs font-medium text-blue-600 hover:bg-blue-50 px-2 py-0.5"
              >
                Clear
              </button>
            )}
          </div>

          <div className="rounded-lg border border-gray-200 bg-white p-3">
            <ol className="relative space-y-2">
              {/* Vertical timeline connector */}
              {versions.length > 1 && (
                <span
                  aria-hidden
                  className="absolute left-[1.125rem] top-3 bottom-3 w-px bg-gradient-to-b from-blue-200 via-gray-200 to-gray-100"
                />
              )}
              {versions.map((v, idx) => {
                const isFrom = v.id === fromId;
                const isTo = v.id === toId;
                const isLatest = idx === 0;
                return (
                  <li
                    key={v.id}
                    data-cy="case-version-row"
                    data-version-id={v.id}
                    data-version={v.version}
                    data-selected={isFrom || isTo ? (isFrom && isTo ? 'both' : isFrom ? 'from' : 'to') : 'none'}
                    className="relative"
                  >
                    <button
                      type="button"
                      data-cy="case-version-row-btn"
                      onClick={() => selectVersion(v.id)}
                      className={`group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition ${
                        isFrom || isTo
                          ? 'border-blue-300 bg-blue-50 shadow-sm'
                          : 'border-transparent hover:border-gray-200 hover:bg-gray-50'
                      }`}
                    >
                      {/* Dot on the timeline */}
                      <span className="relative z-10 mt-0.5">
                        {isLatest ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-600 text-white shadow-sm">
                            <span className="text-[10px] font-bold">N</span>
                          </span>
                        ) : isFrom || isTo ? (
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-blue-600 ${isFrom && isTo ? 'bg-blue-600' : 'bg-white'}`}>
                            <span className={`text-[10px] font-bold ${isFrom && isTo ? 'text-white' : 'text-blue-600'}`}>
                              {isFrom && isTo ? '∗' : isFrom ? 'A' : 'B'}
                            </span>
                          </span>
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-gray-300 bg-white text-[10px] font-bold text-gray-400">
                            {v.version}
                          </span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-semibold text-gray-900">v{v.version}</span>
                          {isLatest && (
                            <span className="rounded bg-green-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-green-800">
                              current
                            </span>
                          )}
                          {isFrom && !isTo && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-800">
                              A
                            </span>
                          )}
                          {isTo && !isFrom && (
                            <span className="rounded bg-purple-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-purple-800">
                              B
                            </span>
                          )}
                          {isFrom && isTo && (
                            <span className="rounded bg-blue-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-blue-800">
                              A & B
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-gray-500">
                          {formatRel(v.created_at)}
                        </div>
                      </div>
                    </button>
                    {!isLatest && canRestore && (
                      <button
                        type="button"
                        data-cy="case-version-restore-btn"
                        data-version-id={v.id}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPendingRestore(v.id);
                        }}
                        className="ml-8 mt-1 inline-flex items-center gap-1 rounded border border-blue-200 bg-white px-2 py-0.5 text-[10px] font-medium text-blue-700 hover:bg-blue-50"
                      >
                        <svg className="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.1a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.277z" clipRule="evenodd" />
                        </svg>
                        Restore this version
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>

        {/* Main panel: diff or snapshot */}
        <div>
          {hasValidDiff ? (
            diffQ.isLoading ? (
              <PanelLoader text="Loading diff…" />
            ) : diffQ.error || !diffQ.data ? (
              <PanelError message="Could not load diff." />
            ) : (
              <CaseDiffView
                diff={diffQ.data}
                fromVersion={diffQ.data.from_version}
                toVersion={diffQ.data.to_version}
              />
            )
          ) : versionQ.isLoading ? (
            <PanelLoader text="Loading version…" />
          ) : versionQ.error || !versionQ.data ? (
            <PanelEmpty
              title="No version selected"
              message="Click a version on the left to view its snapshot, or pick two for a diff."
            />
          ) : (
            <SnapshotView
              snapshot={versionQ.data.snapshot}
              versionLabel={`v${versionQ.data.version}`}
            />
          )}
        </div>
      </div>

      {pendingRestoreVersion && (
        <ConfirmModal
          title={`Restore v${pendingRestoreVersion.version}?`}
          message="The current state will be saved as a new version, then the case will revert to the contents of this older version."
          confirmLabel="Restore"
          onConfirm={confirmRestore}
          onCancel={() => setPendingRestore(null)}
        />
      )}
    </section>
  );
}

function Pill({
  kind,
  value,
  'data-cy': dataCy,
}: {
  kind: 'status' | 'priority';
  value: string;
  'data-cy': string;
}) {
  const palette = pillPalette(kind, value);
  return (
    <span
      data-cy={dataCy}
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium ${palette.bg} ${palette.text} ${palette.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${palette.dot}`} />
      {value}
    </span>
  );
}

function pillPalette(kind: 'status' | 'priority', value: string) {
  if (kind === 'priority') {
    switch (value) {
      case 'high':
        return { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-200', dot: 'bg-red-500' };
      case 'medium':
        return { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200', dot: 'bg-amber-500' };
      case 'low':
        return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' };
      default:
        return { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-400' };
    }
  }
  switch (value) {
    case 'active':
      return { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200', dot: 'bg-blue-500' };
    case 'draft':
      return { bg: 'bg-yellow-50', text: 'text-yellow-800', border: 'border-yellow-200', dot: 'bg-yellow-500' };
    case 'deprecated':
      return { bg: 'bg-gray-100', text: 'text-gray-700', border: 'border-gray-300', dot: 'bg-gray-500' };
    default:
      return { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-400' };
  }
}

function PanelLoader({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white py-12 text-sm text-gray-500">
      <svg className="-ml-1 mr-2 h-4 w-4 animate-spin text-gray-400" viewBox="0 0 24 24" fill="none">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      {text}
    </div>
  );
}

function PanelError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800">{message}</div>
  );
}

function PanelEmpty({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400">
        <svg className="h-6 w-6" viewBox="0 0 20 20" fill="currentColor">
          <path d="M9 2a1 1 0 000 2h2a1 1 0 100-2H9z" />
          <path fillRule="evenodd" d="M4 5a2 2 0 012-2 3 3 0 003 3h2a3 3 0 003-3 2 2 0 012 2v11a2 2 0 01-2 2H6a2 2 0 01-2-2V5zm3 4a1 1 0 000 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h3a1 1 0 100-2H7z" clipRule="evenodd" />
        </svg>
      </div>
      <div className="text-sm font-medium text-gray-900">{title}</div>
      <div className="mt-1 text-xs text-gray-500">{message}</div>
    </div>
  );
}

function SnapshotView({
  snapshot,
  versionLabel,
}: {
  snapshot: import('./api').CaseSnapshot;
  versionLabel: string;
}) {
  return (
    <div data-cy="case-snapshot" className="space-y-4 rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 pb-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-gray-900 px-2 py-0.5 text-xs font-bold text-white">
            {versionLabel}
          </span>
          <span className="text-sm font-medium text-gray-700">Snapshot</span>
        </div>
        <span className="text-xs text-gray-500">Read-only</span>
      </div>
      <Row icon="title" label="Title" value={snapshot.title} />
      <Row icon="description" label="Description" value={snapshot.description} multiline />
      <Row icon="steps" label="Steps" value={snapshot.steps.join('\n')} multiline ordered />
      <Row icon="expected" label="Expected result" value={snapshot.expected_result} multiline />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Row icon="priority" label="Priority" value={snapshot.priority} />
        <Row icon="status" label="Status" value={snapshot.status} />
      </div>
      <Row icon="tags" label="Tags" value={snapshot.tags} />
    </div>
  );
}

function Row({
  label,
  value,
  multiline = false,
  ordered = false,
  icon,
}: {
  label: string;
  value: string | string[];
  multiline?: boolean;
  ordered?: boolean;
  icon: 'title' | 'description' | 'steps' | 'expected' | 'priority' | 'status' | 'tags';
}) {
  const items = Array.isArray(value) ? value : value ? value.split('\n') : [];
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
        <Icon name={icon} />
        {label}
      </div>
      <div className="mt-1.5 text-sm text-gray-800">
        {items.length === 0 || (items.length === 1 && !items[0]) ? (
          <span className="italic text-gray-400">(empty)</span>
        ) : multiline ? (
          ordered ? (
            <ol className="list-decimal space-y-1 pl-5">
              {items.map((line, i) => (
                <li key={i} className="leading-relaxed">
                  {line || <span className="italic text-gray-400">(empty)</span>}
                </li>
              ))}
            </ol>
          ) : (
            <div className={`whitespace-pre-wrap leading-relaxed ${multiline ? '' : ''}`}>
              {value as string}
            </div>
          )
        ) : (
          <div className="leading-relaxed">{value as string}</div>
        )}
      </div>
    </div>
  );
}

function Icon({ name }: { name: 'title' | 'description' | 'steps' | 'expected' | 'priority' | 'status' | 'tags' }) {
  const cls = 'h-3 w-3';
  switch (name) {
    case 'title':
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M3 5a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 11-2 0V6H4v8h6a1 1 0 110 2H4a1 1 0 01-1-1V5z" /></svg>
      );
    case 'description':
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M4 4a2 2 0 012-2h8a2 2 0 012 2v12a2 2 0 01-2 2H6a2 2 0 01-2-2V4zm3 2a1 1 0 000 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h6a1 1 0 100-2H7zm0 4a1 1 0 100 2h4a1 1 0 100-2H7z" clipRule="evenodd" /></svg>
      );
    case 'steps':
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M3 4a1 1 0 011-1h12a1 1 0 011 1v2a1 1 0 11-2 0V5H4v10h11v-1a1 1 0 112 0v2a1 1 0 01-1 1H4a1 1 0 01-1-1V4z" /><path d="M6 8a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm0 3a1 1 0 011-1h6a1 1 0 110 2H7a1 1 0 01-1-1zm0 3a1 1 0 011-1h4a1 1 0 110 2H7a1 1 0 01-1-1z" /></svg>
      );
    case 'expected':
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" /></svg>
      );
    case 'priority':
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path d="M3 12a1 1 0 011-1h2a1 1 0 110 2H4a1 1 0 01-1-1zm0-4a1 1 0 011-1h6a1 1 0 110 2H4a1 1 0 01-1-1zm0-4a1 1 0 011-1h10a1 1 0 110 2H4a1 1 0 01-1-1z" /></svg>
      );
    case 'status':
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M10 2a1 1 0 011 1v1.323l3.954 1.582 1.599-.8a1 1 0 01.894 1.79l-1.233.616 1.738 5.42a1 1 0 01-.285 1.05A3.989 3.989 0 0115 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.715-5.349L11 6.477V16h2a1 1 0 110 2H7a1 1 0 110-2h2V6.477L6.237 7.582l1.715 5.349a1 1 0 01-.285 1.05A3.989 3.989 0 015 15a3.989 3.989 0 01-2.667-1.019 1 1 0 01-.285-1.05l1.738-5.42-1.233-.617a1 1 0 01.894-1.788l1.599.799L9 4.323V3a1 1 0 011-1z" clipRule="evenodd" /></svg>
      );
    case 'tags':
      return (
        <svg className={cls} viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M17.707 9.293a1 1 0 010 1.414l-7 7a1 1 0 01-1.414 0l-7-7A.997.997 0 012 10V5a3 3 0 013-3h5c.256 0 .512.098.707.293l7 7zM5 6a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" /></svg>
      );
  }
}

function formatRel(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return fallback;
}
