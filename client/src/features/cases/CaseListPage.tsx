// The Test Cases list page.
//
// Brings together the toolbar (search + status/priority chips + sort),
// the inline create/edit form, the bulk-selection bar, the row list,
// and the delete-confirm modal. State is local; data comes from
// TanStack Query (`useCases`); mutations are optimistic on the cache.
//
// URL sync: filter + sort are reflected in the query string so links
// are shareable and so the Cypress UI tests can assert on the URL
// after chip clicks.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ConfirmModal } from '@/components/Modal';
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
  'created_desc',
  'created_asc',
  'title_asc',
  'title_desc',
  'priority_desc',
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
  /** null = no modal; otherwise an array of ids to delete on confirm. */
  const [pendingDelete, setPendingDelete] = useState<number[] | null>(null);
  /** Ref for the form section — used to scroll into view when Edit is
   *  clicked on a row far down the list, so the user doesn't lose track
   *  of which case they're editing. */
  const formRef = useRef<HTMLDivElement | null>(null);

  // Scroll the form into view whenever it opens. `behavior: 'smooth'`
  // is friendlier than an instant jump, and `block: 'start'` puts the
  // form heading near the top of the viewport.
  useEffect(() => {
    if (showForm && formRef.current) {
      formRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showForm]);

  // Debounce the search box so we don't refilter on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handle);
  }, [search]);

  // Verdict filter — driven by the dashboard widget's "View all" links.
  // `?verdict=flaky`   → alternating-pattern cases (verdict in
  //                      {possibly_flaky, flaky, very_flaky}).
  // `?verdict=broken`  → regressions (verdict === 'broken').
  // The dashboard widget uses the same `/test-cases/flaky` endpoint as
  // its source of truth, so the case list intersects with that subset.
  // Declared BEFORE the URL mirror effect so the effect can preserve
  // the drill-in param when the user changes other filters.
  const verdictParam = params.get('verdict');
  const verdictFilter: 'flaky' | 'broken' | null =
    verdictParam === 'flaky' || verdictParam === 'broken' ? verdictParam : null;
  const flakyQ = useFlakyList(50);

  // Mirror filters into the URL (replace, not push — back-button stays useful).
  // Preserve any existing `verdict` param so the dashboard drill-in
  // (`?verdict=flaky` / `?verdict=broken`) survives interaction with the
  // other filters on this page — without this, the very first render
  // of /cases?verdict=flaky would lose the param before the banner
  // could mount.
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

    // Verdict drill-in filter — intersect with the dashboard widget's
    // subset. Skip if data hasn't loaded yet; the banner handles the
    // loading state for the user.
    if (verdictIds) {
      out = out.filter((c) => verdictIds.has(c.id));
    }

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
      // Sequential — the optimistic cache update in useDeleteCase
      // removes each row as it succeeds, so the list shrinks live.
      for (const id of ids) await deleteM.mutateAsync(id);
      setSelected((prev) => {
        const next = new Set(prev);
        for (const id of ids) next.delete(id);
        return next;
      });
      const message =
        ids.length === 1
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
    <section>
      {user?.role === 'viewer' && (
        <div
          data-cy="readonly-banner"
          className="mb-4 rounded border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm text-yellow-800"
        >
          Read-only mode — your role is <strong>viewer</strong>. Create, edit, and
          delete actions are disabled.
        </div>
      )}
      {verdictFilter && (
        <div
          data-cy="verdict-filter-banner"
          data-verdict={verdictFilter}
          className={`mb-4 flex items-center justify-between rounded border px-3 py-2 text-sm ${
            verdictFilter === 'broken'
              ? 'border-rose-300 bg-rose-50 text-rose-900'
              : 'border-orange-300 bg-orange-50 text-orange-900'
          }`}
        >
          <div className="flex items-center gap-2">
            <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
              {verdictFilter === 'broken' ? (
                <path d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" />
              ) : (
                <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 017.753-1.977A4.5 4.5 0 0113.5 16h-8z" />
              )}
            </svg>
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
            className={`rounded border px-2 py-0.5 text-xs font-medium ${
              verdictFilter === 'broken'
                ? 'border-rose-400 hover:bg-rose-100'
                : 'border-orange-400 hover:bg-orange-100'
            }`}
          >
            Show all cases
          </button>
        </div>
      )}
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Test Cases</h2>
          <p className="text-sm text-gray-500">Manage individual test cases for your project</p>
        </div>
        <button
          type="button"
          data-cy="case-new-btn"
          data-writable="true"
          onClick={() => {
            setEditing(null);
            setShowForm((s) => !s);
          }}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          {showForm ? '− Cancel' : '+ New Test Case'}
        </button>
      </div>

      {showForm && (
        <div ref={formRef}>
          <CaseForm
            initial={editing ?? undefined}
            knownTags={knownTags}
            submitting={createM.isPending || updateM.isPending}
            onSubmit={(values) =>
              editing ? handleUpdate(values as CaseUpdateInput) : handleCreate(values as CaseCreateInput)
            }
            onCancel={() => {
              setShowForm(false);
              setEditing(null);
            }}
          />
        </div>
      )}

      <div data-cy="toolbar" className="mb-3 space-y-2 rounded border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="search" className="text-sm font-medium">
            Search
          </label>
          <input
            id="search"
            data-cy="search-input"
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search title, description, or tags…"
            autoComplete="off"
            className="min-w-[200px] flex-1 rounded border border-gray-300 px-2 py-1 text-sm focus:border-blue-500 focus:outline-none"
          />
          {search && (
            <button
              type="button"
              data-cy="clear-search-btn"
              onClick={() => setSearch('')}
              className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
            >
              Clear
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium">Status</span>
          <div data-cy="status-filter" className="flex flex-wrap gap-1">
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
          <span className="ml-2 text-sm font-medium">Priority</span>
          <div data-cy="priority-filter" className="flex flex-wrap gap-1">
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
          <label htmlFor="sort" className="text-sm font-medium">
            Sort by
          </label>
          <select
            id="sort"
            data-cy="sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value="created_desc">Newest first</option>
            <option value="created_asc">Oldest first</option>
            <option value="title_asc">Title (A→Z)</option>
            <option value="title_desc">Title (Z→A)</option>
            <option value="priority_desc">Priority (high→low)</option>
          </select>
        </div>
      </div>

      <div data-cy="result-count" className="mb-2 text-sm text-gray-600">
        Showing <strong data-cy="result-count-value">{visible.length}</strong> of{' '}
        <span data-cy="result-total">{cases.length}</span>
      </div>

      {/* Bulk bar is always rendered; hidden via CSS when nothing is
          selected so its [data-cy] element remains queryable. */}
      <div
        data-cy="bulk-bar"
        data-selected-size={selected.size}
        style={{ display: selected.size > 0 ? undefined : 'none' }}
        className="mb-2 flex items-center justify-between rounded border border-gray-200 bg-gray-50 px-3 py-2 text-sm"
      >
          <span>
            <strong data-cy="bulk-count">{selected.size}</strong> selected
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-cy="bulk-clear"
              onClick={() => setSelected(new Set())}
              className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-white"
            >
              Clear
            </button>
            <button
              type="button"
              data-cy="bulk-delete"
              data-writable="true"
              onClick={() => setPendingDelete([...selected])}
              className="rounded bg-red-600 px-2 py-0.5 text-xs font-medium text-white hover:bg-red-700"
            >
              Delete
            </button>
          </div>
      </div>

      {casesQ.isLoading && (
        <div className="py-6 text-center text-sm text-gray-500">Loading test cases…</div>
      )}

      {noCasesAtAll && (
        <div
          data-cy="empty-no-cases"
          className="py-6 text-center text-sm text-gray-500"
        >
          No test cases yet. Click “+ New Test Case” to create one.
        </div>
      )}

      {noMatches && (
        <div
          data-cy="empty-no-matches"
          className="py-6 text-center text-sm text-gray-500"
        >
          No test cases match the current filters.{' '}
          <button
            type="button"
            data-cy="reset-filters"
            onClick={resetFilters}
            className="text-blue-600 hover:underline"
          >
            Reset filters
          </button>
        </div>
      )}

      {!casesQ.isLoading && visible.length > 0 && (
        <ul data-cy="case-list" className="space-y-2">
          {visible.map((c) => (
            <li
              key={c.id}
              data-cy="case-row"
              data-case-id={c.id}
              data-priority={c.priority}
              data-status={c.status}
              data-result={c.result}
              className={`flex items-start gap-3 rounded border bg-white p-3 ${
                selected.has(c.id)
                  ? 'border-blue-400 ring-2 ring-blue-200'
                  : 'border-gray-200'
              }`}
            >
              <input
                type="checkbox"
                data-cy="case-checkbox"
                checked={selected.has(c.id)}
                onChange={(e) => toggleSelect(c.id, e.target.checked)}
                className="mt-1"
                aria-label={`Select ${c.title}`}
              />

              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-3">
                  <Link
                    to={`/cases/${c.id}`}
                    data-cy="case-title"
                    className="break-words font-medium text-gray-900 hover:text-blue-600 hover:underline"
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
                    className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium uppercase tracking-wide result-${c.result} ${
                      c.result === 'passed'
                        ? 'bg-green-100 text-green-800'
                        : c.result === 'failed'
                          ? 'bg-red-100 text-red-800'
                          : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {c.result.replace('_', ' ')}
                  </button>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
                  <span
                    data-cy="case-status"
                    className={`rounded px-1.5 py-0.5 status-${c.status} ${
                      c.status === 'active'
                        ? 'bg-blue-100 text-blue-800'
                        : c.status === 'deprecated'
                          ? 'bg-gray-200 text-gray-600'
                          : 'bg-yellow-100 text-yellow-800'
                    }`}
                  >
                    {c.status}
                  </span>
                  <span
                    data-cy="case-priority"
                    className={`rounded px-1.5 py-0.5 priority-${c.priority} ${
                      c.priority === 'high'
                        ? 'bg-red-100 text-red-800'
                        : c.priority === 'medium'
                          ? 'bg-orange-100 text-orange-800'
                          : 'bg-green-100 text-green-800'
                    }`}
                  >
                    {c.priority}
                  </span>
                  <span data-cy="case-steps-count">
                    {(c.steps?.length ?? 0)} step{(c.steps?.length ?? 0) === 1 ? '' : 's'}
                  </span>
                  <FlakinessBadge caseId={c.id} onlyWhenInteresting />
                </div>

                {(c.tags ?? []).length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1">
                    {(c.tags ?? []).map((t) => (
                      <span
                        key={t}
                        data-cy="case-tag"
                        className="rounded bg-blue-50 px-1.5 py-0.5 text-xs text-blue-700"
                      >
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="flex shrink-0 flex-col gap-1">
                <button
                  type="button"
                  data-cy="case-edit-btn"
                  data-action="edit-case"
                  data-id={c.id}
                  data-writable="true"
                  onClick={() => {
                    setEditing(c);
                    setShowForm(true);
                  }}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  data-cy="case-delete-btn"
                  data-action="delete-case"
                  data-id={c.id}
                  data-writable="true"
                  onClick={() => setPendingDelete([c.id])}
                  className="rounded border border-gray-300 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50"
                  title="Delete"
                >
                  ×
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

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
          lint doesn't drop the constant — it's also exported from
          ./api for any future sibling pages that need it. */}
      {void RESULT_VALUES[0]}
    </section>
  );
}

// ---- helpers ----

interface ChipProps {
  'data-cy': string;
  value: string;
  label: string;
  active: boolean;
  onClick: () => void;
}

function Chip({ value, label, active, onClick, ...rest }: ChipProps) {
  return (
    <span
      {...rest}
      data-value={value}
      onClick={onClick}
      className={`cursor-pointer select-none rounded-full border px-3 py-0.5 text-xs capitalize ${
        active
          ? 'border-blue-600 bg-blue-600 text-white active'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      }`}
    >
      {label}
    </span>
  );
}

function priorityRank(p: string): number {
  if (p === 'high') return 3;
  if (p === 'medium') return 2;
  return 1;
}

function highlight(text: string, q: string): React.ReactNode {
  if (!q) return text;
  // Escape regex metachars in the query so users can search for "(" etc.
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return parts.map((part, i) =>
    part.toLowerCase() === q.toLowerCase() ? (
      <mark key={i} className="hl rounded bg-yellow-200 px-0.5">
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
