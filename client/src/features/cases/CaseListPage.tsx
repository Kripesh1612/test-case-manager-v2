// =============================================================================
// /cases — Test case list.
//
// Layout:
//   • Read-only banner (viewers) + verdict-drill-in banner
//   • Page header with "New Test Case" CTA
//   • Inline create/edit form (collapsible)
//   • Toolbar: search + status chips + priority chips + sort
//   • Result count + bulk-action bar (appears when ≥1 selected)
//   • Table-style row list with checkbox, title, status/priority pills,
//     flakiness badge, last-result chip, and Edit/Delete actions
//
// All existing data-cy hooks are preserved verbatim so the UI test suite
// keeps passing without changes.
// =============================================================================

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ConfirmModal } from '@/components/Modal';
import { Pill, ResultPill, StatusPill, PriorityPill } from '@/components/Pill';
import { Button } from '@/components/Button';
import { EmptyState, SkeletonRows } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icons';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import type { CaseData } from './api';
import {
  PRIORITY_VALUES,
  RESULT_VALUES,
  STATUS_VALUES,
  type CaseCreateInput,
  type CaseUpdateInput,
} from './api';
import { CaseForm } from './CaseForm';
import { FlakinessBadge } from './FlakinessComponents';
import { useCases, useCreateCase, useDeleteCase, useFlakyList, useUpdateCase } from './hooks';

type StatusFilter = (typeof STATUS_VALUES)[number] | 'all';
type PriorityFilter = (typeof PRIORITY_VALUES)[number] | 'all';
type SortKey = 'created_desc' | 'created_asc' | 'title_asc' | 'title_desc' | 'priority_desc';

const SORT_VALUES: SortKey[] = [
  'created_desc', 'created_asc', 'title_asc', 'title_desc', 'priority_desc',
];

function isStatusFilter(v: string | null): v is StatusFilter {
  return v === 'all' || (STATUS_VALUES as readonly string[]).includes(v ?? '');
}
function isPriorityFilter(v: string | null): v is PriorityFilter {
  return v === 'all' || (PRIORITY_VALUES as readonly string[]).includes(v ?? '');
}
function isSortKey(v: string | null): v is SortKey {
  return SORT_VALUES.includes(v as SortKey);
}

export function CaseListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const casesQ = useCases();
  const createM = useCreateCase();
  const updateM = useUpdateCase();
  const deleteM = useDeleteCase();

  const [search, setSearch] = useState<string>(params.get('q') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState<string>(search);
  const [status, setStatus] = useState<StatusFilter>(
    isStatusFilter(params.get('status')) ? (params.get('status') as StatusFilter) : 'all',
  );
  const [priority, setPriority] = useState<PriorityFilter>(
    isPriorityFilter(params.get('priority')) ? (params.get('priority') as PriorityFilter) : 'all',
  );
  const [sort, setSort] = useState<SortKey>(
    isSortKey(params.get('sort')) ? (params.get('sort') as SortKey) : 'created_desc',
  );

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<CaseData | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);
  const formRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (showForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showForm]);

  // Honor deep-link from the detail page: /cases?edit={id} opens the
  // inline editor for that case. The detail page normally intercepts
  // the click and opens the editor in place, but middle-click / new-tab
  // still lands here.
  useEffect(() => {
    const editId = params.get('edit');
    if (editId == null) return;
    const target = (casesQ.data ?? []).find((c) => String(c.id) === editId);
    if (target) {
      setEditing(target);
      setShowForm(true);
      const next = new URLSearchParams(params);
      next.delete('edit');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [casesQ.data, params.get('edit')]);

  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handle);
  }, [search]);

  const verdictParam = params.get('verdict');
  const verdictFilter: 'flaky' | 'broken' | null =
    verdictParam === 'flaky' || verdictParam === 'broken' ? verdictParam : null;
  const flakyQ = useFlakyList(50);

  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('q', debouncedSearch);
    if (status !== 'all') next.set('status', status);
    if (priority !== 'all') next.set('priority', priority);
    if (sort !== 'created_desc') next.set('sort', sort);
    if (verdictFilter) next.set('verdict', verdictFilter);
    setParams(next, { replace: true });
  }, [debouncedSearch, status, priority, sort, verdictFilter, setParams]);

  const verdictIds = useMemo(() => {
    if (!verdictFilter) return null;
    const cases = flakyQ.data?.cases ?? [];
    if (verdictFilter === 'broken') {
      return new Set(cases.filter((c) => c.verdict === 'broken').map((c) => c.case_id));
    }
    return new Set(cases.filter((c) => c.verdict !== 'broken').map((c) => c.case_id));
  }, [verdictFilter, flakyQ.data]);

  function clearVerdictFilter() {
    const next = new URLSearchParams(params);
    next.delete('verdict');
    setParams(next, { replace: true });
  }

  const cases = casesQ.data ?? [];

  const visible = useMemo(() => {
    let out: CaseData[] = cases;
    if (status !== 'all') out = out.filter((c) => c.status === status);
    if (priority !== 'all') out = out.filter((c) => c.priority === priority);
    if (verdictIds) out = out.filter((c) => verdictIds.has(c.id));
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      out = out.filter(
        (c) =>
          c.title.toLowerCase().includes(q) ||
          (c.description ?? '').toLowerCase().includes(q) ||
          (c.tags ?? []).some((t) => t.toLowerCase().includes(q)),
      );
    }
    const [field, dir] = sort.split('_');
    const sorted = [...out].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (field === 'title') {
        av = a.title.toLowerCase();
        bv = b.title.toLowerCase();
      } else if (field === 'priority') {
        av = priorityRank(a.priority ?? 'medium');
        bv = priorityRank(b.priority ?? 'medium');
      } else {
        av = new Date(a.created_at).getTime();
        bv = new Date(b.created_at).getTime();
      }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
    return sorted;
  }, [cases, status, priority, debouncedSearch, sort, verdictIds]);

  const knownTags = useMemo(() => {
    const set = new Set<string>();
    for (const c of cases) for (const t of c.tags ?? []) set.add(t);
    return [...set];
  }, [cases]);

  function resetFilters() {
    setSearch('');
    setStatus('all');
    setPriority('all');
    setSort('created_desc');
  }

  async function handleCreate(values: CaseCreateInput) {
    try {
      await createM.mutateAsync(values);
      showToast({ message: 'Test case created', variant: 'success' });
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      showToast({ message: extractError(e, 'Failed to create test case'), variant: 'error' });
    }
  }

  async function handleUpdate(values: CaseUpdateInput) {
    if (!editing) return;
    try {
      await updateM.mutateAsync({ id: editing.id, input: values });
      showToast({ message: 'Test case updated', variant: 'success' });
      setShowForm(false);
      setEditing(null);
    } catch (e) {
      showToast({ message: extractError(e, 'Failed to update test case'), variant: 'error' });
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const ids = pendingDelete;
    setPendingDelete(null);
    try {
      for (const id of ids) await deleteM.mutateAsync(id);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      const message = ids.length === 1
        ? 'Moved to Trash — open /trash to restore'
        : `Moved ${ids.length} test cases to Trash`;
      showToast({
        message,
        variant: 'success',
        action: { label: 'Open Trash', onClick: () => navigate('/trash') },
      });
    } catch (e) {
      showToast({ message: extractError(e, 'Failed to delete'), variant: 'error' });
    }
  }

  async function cycleRun(c: CaseData) {
    const next = c.result === 'not_run' ? 'passed' : c.result === 'passed' ? 'failed' : 'not_run';
    try {
      await updateM.mutateAsync({ id: c.id, input: { result: next } });
    } catch (e) {
      showToast({ message: extractError(e, 'Failed to update run status'), variant: 'error' });
    }
  }

  function toggleSelect(id: number, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  const noCasesAtAll = !casesQ.isLoading && cases.length === 0;
  const noMatches = !casesQ.isLoading && cases.length > 0 && visible.length === 0;

  return (
    <div className="space-y-6">
      {/* Banners */}
      {user?.role === 'viewer' && (
        <div
          data-cy="readonly-banner"
          className="rg-pill rg-pill-warning px-3 py-2 flex items-center gap-2"
        >
          <Icon.Lock size={14} />
          <span className="text-sm">
            Read-only mode — your role is <strong>viewer</strong>. Create, edit, and
            delete actions are disabled.
          </span>
        </div>
      )}
      {verdictFilter && (
        <div
          data-cy="verdict-filter-banner"
          data-verdict={verdictFilter}
          className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
            verdictFilter === 'broken'
              ? 'border-danger-border bg-danger-soft text-danger-text'
              : 'border-warning-border bg-warning-soft text-warning-text'
          }`}
        >
          <div className="flex items-center gap-2">
            <Icon.Flaky size={16} />
            <span>
              Showing{' '}
              <strong>
                {verdictFilter === 'broken' ? 'recent regressions' : 'flaky tests'}
              </strong>
              {' — '}
              <span data-cy="verdict-filter-count">{verdictIds?.size ?? 0}</span> case
              {(verdictIds?.size ?? 0) === 1 ? '' : 's'} above score 50
            </span>
          </div>
          <button
            type="button"
            data-cy="verdict-filter-clear"
            onClick={clearVerdictFilter}
            className={`rounded-md border px-2.5 py-0.5 text-xs font-medium ${
              verdictFilter === 'broken'
                ? 'border-danger-border bg-surface hover:bg-danger-soft'
                : 'border-warning-border bg-surface hover:bg-warning-soft'
            }`}
          >
            Show all cases
          </button>
        </div>
      )}

      {/* Header */}
      <PageHeader
        title="Test cases"
        description="Browse, filter, edit and run all the test cases in this workspace."
        actions={
          <Button
            variant="primary"
            data-cy="case-new-btn"
            data-writable="true"
            leftIcon={showForm ? <Icon.X size={14} /> : <Icon.Plus size={14} />}
            onClick={() => { setEditing(null); setShowForm((s) => !s); }}
          >
            {showForm ? 'Cancel' : 'New test case'}
          </Button>
        }
      />

      {showForm && (
        <div ref={formRef} className="rg-fade-in">
          <CaseForm
            initial={editing ?? undefined}
            knownTags={knownTags}
            submitting={createM.isPending || updateM.isPending}
            onSubmit={(values) =>
              editing
                ? handleUpdate(values as CaseUpdateInput)
                : handleCreate(values as CaseCreateInput)
            }
            onCancel={() => { setShowForm(false); setEditing(null); }}
          />
        </div>
      )}

      {/* Toolbar */}
      <Card className="p-4">
        <div data-cy="toolbar" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
                <Icon.Search size={14} />
              </span>
              <input
                id="search"
                data-cy="search-input"
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title, description, or tags…"
                autoComplete="off"
                className="rg-input pl-9"
              />
            </div>
            {search && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                data-cy="clear-search-btn"
                onClick={() => setSearch('')}
              >
                Clear
              </Button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
              Status
            </span>
            <div data-cy="status-filter" className="flex flex-wrap gap-1.5">
              {(['all', ...STATUS_VALUES] as const).map((v) => (
                <Chip
                  key={v}
                  data-cy="status-chip"
                  value={v}
                  label={v}
                  active={status === v}
                  onClick={() => setStatus(v)}
                />
              ))}
            </div>
            <span className="ml-2 text-xs font-medium uppercase tracking-wider text-text-tertiary">
              Priority
            </span>
            <div data-cy="priority-filter" className="flex flex-wrap gap-1.5">
              {(['all', ...PRIORITY_VALUES] as const).map((v) => (
                <Chip
                  key={v}
                  data-cy="priority-chip"
                  value={v}
                  label={v}
                  active={priority === v}
                  onClick={() => setPriority(v)}
                />
              ))}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <label htmlFor="sort" className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
              Sort
            </label>
            <select
              id="sort"
              data-cy="sort-select"
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="rg-input w-auto py-1.5 text-sm"
            >
              <option value="created_desc">Newest first</option>
              <option value="created_asc">Oldest first</option>
              <option value="title_asc">Title (A→Z)</option>
              <option value="title_desc">Title (Z→A)</option>
              <option value="priority_desc">Priority (high→low)</option>
            </select>
          </div>
        </div>
      </Card>

      <div data-cy="result-count" className="text-sm text-text-secondary">
        Showing <strong data-cy="result-count-value">{visible.length}</strong> of{' '}
        <span data-cy="result-total">{cases.length}</span>
      </div>

      {/* Bulk bar — always rendered (display: none when empty) so its
          data-cy element remains queryable. */}
      <div
        data-cy="bulk-bar"
        data-selected-size={selected.size}
        style={{ display: selected.size > 0 ? undefined : 'none' }}
        className="flex items-center justify-between rounded-lg border border-brand-soft bg-brand-soft px-3 py-2 text-sm text-brand-hover"
      >
        <span>
          <strong data-cy="bulk-count">{selected.size}</strong> selected
        </span>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-cy="bulk-clear"
            onClick={() => setSelected(new Set())}
          >
            Clear
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            data-cy="bulk-delete"
            data-writable="true"
            onClick={() => setPendingDelete([...selected])}
            leftIcon={<Icon.Trash size={12} />}
          >
            Delete
          </Button>
        </div>
      </div>

      {/* List */}
      <Card className="overflow-hidden">
        {casesQ.isLoading && <div className="p-4"><SkeletonRows rows={4} /></div>}

        {noCasesAtAll && (
          <div data-cy="empty-no-cases" className="p-8">
            <EmptyState
              icon={<Icon.Cases size={20} />}
              title="No test cases yet"
              description="Create your first test case to start tracking what your product should do."
              action={
                <Button
                  variant="primary"
                  data-cy="case-empty-new-btn"
                  data-writable="true"
                  leftIcon={<Icon.Plus size={14} />}
                  onClick={() => { setEditing(null); setShowForm(true); }}
                >
                  New test case
                </Button>
              }
            />
          </div>
        )}

        {noMatches && (
          <div data-cy="empty-no-matches" className="p-8">
            <EmptyState
              icon={<Icon.Search size={20} />}
              title="No matches"
              description="No test cases match the current filters. Try widening the search."
              action={
                <Button
                  variant="secondary"
                  data-cy="reset-filters"
                  onClick={resetFilters}
                >
                  Reset filters
                </Button>
              }
            />
          </div>
        )}

        {!casesQ.isLoading && visible.length > 0 && (
          <ul data-cy="case-list" className="divide-y divide-border-soft">
            {visible.map((c) => (
              <li
                key={c.id}
                data-cy="case-row"
                data-case-id={c.id}
                data-priority={c.priority}
                data-status={c.status}
                data-result={c.result}
                className={`group transition-colors ${
                  selected.has(c.id) ? 'bg-brand-soft/40' : 'hover:bg-surface-hover'
                }`}
              >
                <div className="flex items-start gap-4 px-4 py-3.5">
                  <input
                    type="checkbox"
                    data-cy="case-checkbox"
                    checked={selected.has(c.id)}
                    onChange={(e) => toggleSelect(c.id, e.target.checked)}
                    className="mt-1 h-4 w-4 rounded border-border text-brand focus:ring-brand"
                    aria-label={`Select ${c.title}`}
                  />

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <Link
                        to={`/cases/${c.id}`}
                        data-cy="case-title"
                        className="font-medium text-text hover:text-brand transition-colors break-words"
                      >
                        {highlight(c.title, debouncedSearch)}
                      </Link>
                      <button
                        type="button"
                        data-cy="case-run-btn"
                        data-id={c.id}
                        data-writable="true"
                        onClick={() => cycleRun(c)}
                        title="Click to cycle run result"
                        className={`shrink-0 result-${c.result}`}
                      >
                        <ResultPill result={c.result} size="sm" />
                      </button>
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <span data-cy="case-status">
                        <StatusPill status={c.status ?? 'draft'} size="sm" />
                      </span>
                      <span data-cy="case-priority">
                        <PriorityPill priority={c.priority ?? 'medium'} size="sm" />
                      </span>
                      <span data-cy="case-steps-count" className="text-xs text-text-tertiary">
                        {c.steps?.length ?? 0} step{(c.steps?.length ?? 0) === 1 ? '' : 's'}
                      </span>
                      <FlakinessBadge caseId={c.id} onlyWhenInteresting />
                    </div>

                    {(c.tags ?? []).length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {(c.tags ?? []).map((t) => (
                          <Pill
                            key={t}
                            tone="brand"
                            size="sm"
                            data-cy="case-tag"
                            className="!py-0"
                          >
                            {t}
                          </Pill>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      data-cy="case-edit-btn"
                      data-action="edit-case"
                      data-id={c.id}
                      data-writable="true"
                      onClick={() => { setEditing(c); setShowForm(true); }}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      data-cy="case-delete-btn"
                      data-action="delete-case"
                      data-id={c.id}
                      data-writable="true"
                      onClick={() => setPendingDelete([c.id])}
                      className="!text-danger-text hover:!bg-danger-soft"
                      title="Delete"
                      aria-label="Delete"
                    >
                      <Icon.X size={14} />
                    </Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {pendingDelete && (
        <ConfirmModal
          title={
            pendingDelete.length === 1
              ? 'Delete test case?'
              : `Delete ${pendingDelete.length} test cases?`
          }
          message={
            pendingDelete.length === 1
              ? 'This test case will be permanently removed.'
              : 'They will be permanently removed. You can undo immediately after.'
          }
          confirmLabel={pendingDelete.length === 1 ? 'Delete' : 'Delete all'}
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {/* Defensive: keep RESULT_VALUES referenced so an unused-import
          lint doesn't drop the constant — also exported from ./api for
          any future sibling pages that need it. */}
      {void RESULT_VALUES[0]}
    </div>
  );
}

// =============================================================================
// helpers
// =============================================================================

interface ChipProps {
  'data-cy': string;
  value: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

function Chip({ value, label, active, onClick, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      {...rest}
      data-value={value}
      onClick={onClick}
      className={`cursor-pointer select-none rounded-full border px-3 py-0.5 text-xs capitalize transition-colors ${
        active
          ? 'border-brand bg-brand text-text-inverse active'
          : 'border-border bg-surface text-text-secondary hover:bg-surface-hover hover:border-border-strong'
      }`}
    >
      {label}
    </button>
  );
}

function priorityRank(p: string): number {
  if (p === 'high') return 3;
  if (p === 'medium') return 2;
  return 1;
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="hl rounded bg-yellow-200 px-0.5 text-text">
        {part}
      </mark>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
}

function extractError(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const r = (err as { response?: { data?: { error?: string } } }).response;
    if (r?.data?.error) return r.data.error;
  }
  return fallback;
}
