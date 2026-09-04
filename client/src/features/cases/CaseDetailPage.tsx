// =============================================================================
// CaseDetailPage — read-only view of one test case + version history.
//
// Layout:
//   1. Breadcrumb + header card (title, status/priority pills, tags, edit btn)
//   2. Two-column body: left = timeline version list, right = diff/snapshot
//   3. Restore button (admin/editor) per older version, with confirm modal
//
// Flakiness + execution panels sit BELOW the header and span full width,
// so the diff grid stays focused on what changes over time.
// =============================================================================

import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';

import { ConfirmModal } from '@/components/Modal';
import { Pill, StatusPill, PriorityPill } from '@/components/Pill';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Icon } from '@/components/Icons';
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
      <div className="flex items-center justify-center py-16 text-sm text-text-secondary">
        <span className="rg-spin inline-block h-4 w-4 mr-2 rounded-full border-2 border-brand border-t-transparent" />
        Loading case…
      </div>
    );
  }

  if (caseQ.error || !caseQ.data) {
    return (
      <Card className="p-10 text-center">
        <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-danger-soft text-danger">
          <Icon.Warning size={22} />
        </div>
        <div className="text-sm font-medium text-text">Test case not found</div>
        <div className="mt-1 text-xs text-text-secondary">It may have been deleted.</div>
        <Link
          to="/cases"
          data-cy="case-detail-back"
          className="mt-4 inline-flex items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-medium text-text hover:bg-surface-hover"
        >
          ← Back to all cases
        </Link>
      </Card>
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
    <section data-cy="case-detail-page" className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs">
        <Link
          to="/cases"
          data-cy="case-detail-back"
          className="inline-flex items-center gap-1 text-text-secondary hover:text-text"
        >
          <Icon.Chevron size={12} className="rotate-180" />
          All cases
        </Link>
        <span className="text-text-tertiary">/</span>
        <span className="text-text-secondary">Case #{tc.id}</span>
      </nav>

      {/* Header card */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-tertiary">
              <span className="rounded bg-surface-sunken px-2 py-0.5">Test case</span>
              <span>#{tc.id}</span>
            </div>
            <h2
              data-cy="case-detail-title"
              className="mt-2 break-words text-2xl font-semibold tracking-tight text-text"
            >
              {tc.title}
            </h2>
            <div className="mt-3 flex flex-wrap items-center gap-1.5">
              <span data-cy="case-detail-status">
                <StatusPill status={status} size="md" />
              </span>
              <span data-cy="case-detail-priority">
                <PriorityPill priority={priority} size="md" />
              </span>
              <span
                data-cy="case-detail-version-count"
                className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs font-medium text-text-secondary"
              >
                <Icon.Versions size={12} />
                {versions.length} version{versions.length === 1 ? '' : 's'}
              </span>
              {(tc.tags ?? []).length > 0 && (tc.tags ?? []).map((tag) => (
                <Pill key={tag} tone="brand" size="sm">#{tag}</Pill>
              ))}
            </div>
          </div>
          <Link
            to={`/cases?edit=${tc.id}`}
            data-cy="case-edit-btn"
            data-writable="true"
          >
            <Button variant="secondary" leftIcon={<Icon.Settings size={14} />}>
              Edit
            </Button>
          </Link>
        </div>
      </Card>

      {/* Flakiness + Execution panels (full-width) */}
      <FlakinessPanel caseId={caseId} />
      <RunPanel caseData={tc} />

      {/* Two-column body: version timeline + diff/snapshot */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="space-y-3" data-cy="case-version-list">
          <Card className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Icon.Versions size={16} className="text-text-secondary" />
              <h3 className="text-sm font-semibold text-text">Version history</h3>
            </div>
            {hasValidDiff && (
              <button
                type="button"
                data-cy="case-diff-clear"
                onClick={clearSelection}
                className="text-xs font-medium text-brand hover:text-brand-hover"
              >
                Clear
              </button>
            )}
          </Card>

          <Card className="p-3">
            <ol className="relative space-y-1.5">
              {versions.length > 1 && (
                <span
                  aria-hidden
                  className="absolute left-[1.125rem] top-3 bottom-3 w-px bg-gradient-to-b from-brand via-border to-border-soft"
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
                    data-selected={
                      isFrom || isTo
                        ? isFrom && isTo ? 'both' : isFrom ? 'from' : 'to'
                        : 'none'
                    }
                    className="relative"
                  >
                    <button
                      type="button"
                      data-cy="case-version-row-btn"
                      onClick={() => selectVersion(v.id)}
                      className={`group flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors ${
                        isFrom || isTo
                          ? 'border-brand bg-brand-soft shadow-sm'
                          : 'border-transparent hover:border-border hover:bg-surface-hover'
                      }`}
                    >
                      <span className="relative z-10 mt-0.5">
                        {isLatest ? (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand text-text-inverse shadow-sm">
                            <span className="text-[10px] font-bold">N</span>
                          </span>
                        ) : isFrom || isTo ? (
                          <span className={`flex h-5 w-5 items-center justify-center rounded-full border-2 border-brand ${isFrom && isTo ? 'bg-brand' : 'bg-surface'}`}>
                            <span className={`text-[10px] font-bold ${isFrom && isTo ? 'text-text-inverse' : 'text-brand'}`}>
                              {isFrom && isTo ? '∗' : isFrom ? 'A' : 'B'}
                            </span>
                          </span>
                        ) : (
                          <span className="flex h-5 w-5 items-center justify-center rounded-full border-2 border-border bg-surface text-[10px] font-bold text-text-tertiary">
                            {v.version}
                          </span>
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span className="font-semibold text-text">v{v.version}</span>
                          {isLatest && (
                            <span className="rounded bg-success-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-success-text">
                              current
                            </span>
                          )}
                          {isFrom && !isTo && (
                            <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-hover">
                              A
                            </span>
                          )}
                          {isTo && !isFrom && (
                            <span className="rounded bg-accent-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-accent">
                              B
                            </span>
                          )}
                          {isFrom && isTo && (
                            <span className="rounded bg-brand-soft px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-brand-hover">
                              A & B
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 truncate text-[11px] text-text-tertiary">
                          {formatRel(v.created_at)}
                        </div>
                      </div>
                    </button>
                    {!isLatest && canRestore && (
                      <button
                        type="button"
                        data-cy="case-version-restore-btn"
                        data-version-id={v.id}
                        onClick={(e) => { e.stopPropagation(); setPendingRestore(v.id); }}
                        className="ml-8 mt-1.5 inline-flex items-center gap-1 rounded-md border border-brand bg-surface px-2 py-0.5 text-[10px] font-medium text-brand-hover hover:bg-brand-soft"
                      >
                        <Icon.Restore size={11} />
                        Restore this version
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>
        </aside>

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

// =============================================================================
// Snapshot view — read-only rendering of one CaseSnapshot.
// =============================================================================

function SnapshotView({
  snapshot,
  versionLabel,
}: {
  snapshot: import('./api').CaseSnapshot;
  versionLabel: string;
}) {
  return (
    <div data-cy="case-snapshot" className="space-y-4 rounded-xl border border-border bg-surface p-6 shadow-card">
      <div className="flex items-center justify-between border-b border-border-soft pb-3">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-text px-2 py-0.5 text-xs font-bold text-text-inverse">
            {versionLabel}
          </span>
          <span className="text-sm font-medium text-text-secondary">Snapshot</span>
        </div>
        <span className="text-xs text-text-tertiary">Read-only</span>
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
  const I = (
    <span className="inline-flex items-center gap-1.5">
      {icon === 'title' && <Icon.Cases size={12} />}
      {icon === 'description' && <Icon.Cases size={12} />}
      {icon === 'steps' && <Icon.Run size={12} />}
      {icon === 'expected' && <Icon.Check size={12} />}
      {icon === 'priority' && <Icon.Flaky size={12} />}
      {icon === 'status' && <Icon.Schedule size={12} />}
      {icon === 'tags' && <Icon.Spark size={12} />}
      {label}
    </span>
  );
  return (
    <div>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-text-tertiary">
        {I}
      </div>
      <div className="mt-1.5 text-sm text-text">
        {items.length === 0 || (items.length === 1 && !items[0]) ? (
          <span className="italic text-text-tertiary">(empty)</span>
        ) : multiline ? (
          ordered ? (
            <ol className="list-decimal space-y-1 pl-5">
              {items.map((line, i) => (
                <li key={i} className="leading-relaxed">
                  {line || <span className="italic text-text-tertiary">(empty)</span>}
                </li>
              ))}
            </ol>
          ) : (
            <div className="whitespace-pre-wrap leading-relaxed">{value as string}</div>
          )
        ) : (
          <div className="leading-relaxed">{value as string}</div>
        )}
      </div>
    </div>
  );
}

function PanelLoader({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center rounded-xl border border-border bg-surface py-12 text-sm text-text-secondary">
      <span className="rg-spin inline-block h-4 w-4 mr-2 rounded-full border-2 border-brand border-t-transparent" />
      {text}
    </div>
  );
}

function PanelError({ message }: { message: string }) {
  return (
    <div className="rounded-xl border border-danger-border bg-danger-soft p-4 text-sm text-danger-text">
      {message}
    </div>
  );
}

function PanelEmpty({ title, message }: { title: string; message: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface p-12 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-surface-sunken text-text-tertiary">
        <Icon.Cases size={22} />
      </div>
      <div className="text-sm font-medium text-text">{title}</div>
      <div className="mt-1 text-xs text-text-secondary">{message}</div>
    </div>
  );
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
