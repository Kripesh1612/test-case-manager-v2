// =============================================================================
// /test-suites — the Test Suites list page.
//
// Brings together the toolbar (search + sort), the inline create/edit
// form, the suite list, and the delete-confirm modal. State is local;
// data comes from TanStack Query (`useSuites` + `useCases`); mutations
// are optimistic on the cache.
//
// URL sync: search + sort are reflected in the query string so links
// are shareable and so the Cypress UI tests can assert on the URL
// after chip clicks.
//
// All existing data-cy hooks are preserved verbatim so the UI test
// suite keeps passing without changes.
// =============================================================================

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState, SkeletonRows } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { ConfirmModal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import { useCases } from '@/features/cases/hooks';
import type { CaseData } from '@/features/cases/api';

import type { Suite, SuiteCreateInput } from './api';
import { useCreateSuite, useDeleteSuite, useSuites, useUpdateSuite } from './hooks';

type SortKey =
  | 'created_desc'
  | 'created_asc'
  | 'name_asc'
  | 'name_desc'
  | 'size_desc';

const SORT_VALUES: SortKey[] = [
  'created_desc',
  'created_asc',
  'name_asc',
  'name_desc',
  'size_desc',
];

const SORT_LABELS: Record<SortKey, string> = {
  created_desc: 'Newest first',
  created_asc: 'Oldest first',
  name_asc: 'Name (A→Z)',
  name_desc: 'Name (Z→A)',
  size_desc: 'Most cases',
};

function isSortKey(v: string | null): v is SortKey {
  return !!v && (SORT_VALUES as readonly string[]).includes(v);
}

interface SuiteFormState {
  name: string;
  description: string;
  test_case_ids: number[];
}

const EMPTY_FORM: SuiteFormState = { name: '', description: '', test_case_ids: [] };

export function SuiteListPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [params, setParams] = useSearchParams();
  const suitesQ = useSuites();
  const casesQ = useCases();
  const createM = useCreateSuite();
  const updateM = useUpdateSuite();
  const deleteM = useDeleteSuite();

  const [search, setSearch] = useState<string>(params.get('q') ?? '');
  const [debouncedSearch, setDebouncedSearch] = useState<string>(search);
  const [sort, setSort] = useState<SortKey>(
    isSortKey(params.get('sort')) ? (params.get('sort') as SortKey) : 'created_desc',
  );

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<SuiteFormState>(EMPTY_FORM);
  /** null = no modal; otherwise the suite pending deletion. */
  const [pendingDelete, setPendingDelete] = useState<Suite | null>(null);

  const writable = user?.role !== 'viewer';

  // Debounce the search box so we don't refilter on every keystroke.
  useEffect(() => {
    const handle = setTimeout(() => setDebouncedSearch(search), 200);
    return () => clearTimeout(handle);
  }, [search]);

  // Mirror filters into the URL (replace, not push — back-button stays useful).
  useEffect(() => {
    const next = new URLSearchParams();
    if (debouncedSearch) next.set('q', debouncedSearch);
    if (sort !== 'created_desc') next.set('sort', sort);
    setParams(next, { replace: true });
  }, [debouncedSearch, sort, setParams]);

  const suites = suitesQ.data ?? [];
  const allCases: CaseData[] = casesQ.data ?? [];

  const visible = useMemo(() => {
    const q = debouncedSearch.trim().toLowerCase();
    let out = suites;
    if (q) {
      out = out.filter(
        (s) =>
          s.name.toLowerCase().includes(q) ||
          (s.description ?? '').toLowerCase().includes(q),
      );
    }
    const [field, dir] = sort.split('_') as [string, 'asc' | 'desc'];
    return [...out].sort((a, b) => {
      let av: number | string;
      let bv: number | string;
      if (field === 'name') {
        av = a.name.toLowerCase();
        bv = b.name.toLowerCase();
      } else if (field === 'size') {
        av = a.test_case_ids.length;
        bv = b.test_case_ids.length;
      } else {
        av = new Date(a.created_at).getTime();
        bv = new Date(b.created_at).getTime();
      }
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }, [suites, debouncedSearch, sort]);

  const resetFilters = () => {
    setSearch('');
    setSort('created_desc');
  };

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormOpen(true);
  };

  const openEdit = (suite: Suite) => {
    setEditingId(suite.id);
    setForm({
      name: suite.name,
      description: suite.description ?? '',
      test_case_ids: suite.test_case_ids,
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    const payload: SuiteCreateInput = {
      name: form.name.trim(),
      description: form.description.trim() || undefined,
      test_case_ids: form.test_case_ids,
    };
    try {
      if (editingId !== null) {
        await updateM.mutateAsync({ id: editingId, input: payload });
        showToast({ message: 'Suite updated', variant: 'success' });
      } else {
        await createM.mutateAsync(payload);
        showToast({ message: 'Suite created', variant: 'success' });
      }
      closeForm();
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete.id;
    try {
      await deleteM.mutateAsync(id);
      showToast({
        message: 'Moved to Trash — open /trash to restore',
        variant: 'success',
        action: { label: 'Open Trash', onClick: () => navigate('/trash') },
      });
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Test suites"
        title="Test Suites"
        description="Group related test cases into reusable suites you can run together."
        actions={
          <Button
            type="button"
            variant="primary"
            data-cy="suite-new-btn"
            data-writable="true"
            hidden={!writable}
            leftIcon={formOpen ? <Icon.X size={14} /> : <Icon.Plus size={14} />}
            onClick={formOpen ? closeForm : openCreate}
          >
            {formOpen ? 'Cancel' : 'New test suite'}
          </Button>
        }
      />

      <Card className="p-4">
        <div data-cy="toolbar" className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[240px]">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
                <Icon.Search size={14} />
              </span>
              <input
                id="suite-search"
                data-cy="search-input"
                type="search"
                placeholder="Search suite names or descriptions…"
                autoComplete="off"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="rg-input pl-9"
              />
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              data-cy="clear-search-btn"
              hidden={!search}
              onClick={() => setSearch('')}
            >
              Clear
            </Button>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
              Sort
            </span>
            <div className="relative flex-1 min-w-[200px]">
              <select
                id="suite-sort"
                data-cy="sort-select"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="rg-input w-full appearance-none pr-9"
              >
                {SORT_VALUES.map((k) => (
                  <option key={k} value={k}>
                    {SORT_LABELS[k]}
                  </option>
                ))}
              </select>
              <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary">
                <Icon.Chevron size={14} />
              </span>
            </div>
          </div>
        </div>
      </Card>

      <div data-cy="result-count" className="flex items-center justify-between text-sm text-text-secondary">
        <span>
          Showing <strong data-cy="result-count-value" className="text-text">{visible.length}</strong> of{' '}
          <span data-cy="result-total" className="text-text">{suites.length}</span> suite
          {suites.length === 1 ? '' : 's'}
        </span>
      </div>

      <div
        data-cy="suite-form"
        hidden={!formOpen}
        className="rg-fade-in"
      >
        <Card className="p-5">
          <form onSubmit={submitForm} className="space-y-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-md bg-brand-soft text-brand">
                <Icon.Suites size={14} />
              </span>
              <div>
                <h3 className="text-sm font-semibold text-text">
                  {editingId !== null ? 'Edit test suite' : 'New test suite'}
                </h3>
                <p className="text-xs text-text-secondary">
                  Pick a name and the cases that belong to this suite.
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <label htmlFor="suite-name" className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Name
              </label>
              <input
                id="suite-name"
                name="name"
                data-cy="suite-name-input"
                placeholder="Suite name"
                required
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                className="rg-input"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="suite-description" className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Description
              </label>
              <textarea
                id="suite-description"
                name="description"
                data-cy="suite-description-input"
                placeholder="What does this suite cover?"
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                rows={3}
                className="rg-input resize-y"
              />
            </div>

            <div className="space-y-1.5">
              <label htmlFor="suite-cases" className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Test cases <span className="text-text-tertiary/70 normal-case">(Ctrl/Cmd-click to select multiple)</span>
              </label>
              <select
                id="suite-cases"
                multiple
                size={8}
                data-cy="suite-cases-select"
                value={form.test_case_ids.map(String)}
                onChange={(e) => {
                  const ids = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
                  setForm((f) => ({ ...f, test_case_ids: ids }));
                }}
                className="rg-input font-mono text-xs"
              >
                {allCases.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
              </select>
              {form.test_case_ids.length > 0 && (
                <p className="text-xs text-text-secondary">
                  {form.test_case_ids.length} case{form.test_case_ids.length === 1 ? '' : 's'} selected
                </p>
              )}
            </div>

            <div className="flex items-center justify-end gap-2 pt-1">
              <Button
                type="button"
                variant="secondary"
                data-cy="suite-cancel-btn"
                onClick={closeForm}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                variant="primary"
                data-cy="suite-submit-btn"
                loading={createM.isPending || updateM.isPending}
              >
                {editingId !== null ? 'Update suite' : 'Create suite'}
              </Button>
            </div>
          </form>
        </Card>
      </div>

      <Card className="overflow-hidden">
        {suitesQ.isLoading ? (
          <div className="p-4">
            <SkeletonRows rows={4} />
          </div>
        ) : (
          <>
            {suites.length === 0 ? (
              <div data-cy="empty-no-suites">
                <EmptyState
                  icon={<Icon.Suites size={20} />}
                  title="No test suites yet"
                  description={
                    writable
                      ? 'Click "New test suite" above to group related test cases.'
                      : 'No test suites have been created in this workspace yet.'
                  }
                />
              </div>
            ) : null}
            {suites.length > 0 && visible.length === 0 ? (
              <div data-cy="empty-no-matches">
                <EmptyState
                  icon={<Icon.Search size={20} />}
                  title="No suites match"
                  description="Try a different search term or reset the filters."
                  action={
                    <Button
                      type="button"
                      variant="secondary"
                      data-cy="reset-filters"
                      onClick={resetFilters}
                    >
                      Reset filters
                    </Button>
                  }
                />
              </div>
            ) : null}
            <ul
              data-cy="suite-list"
              className={`divide-y divide-border-soft ${visible.length === 0 ? 'hidden' : ''}`}
            >
              {visible.map((s) => (
                <SuiteRow
                  key={s.id}
                  suite={s}
                  search={debouncedSearch}
                  writable={writable}
                  onEdit={() => openEdit(s)}
                  onDelete={() => setPendingDelete(s)}
                />
              ))}
            </ul>
          </>
        )}
      </Card>

      {pendingDelete && (
        <ConfirmModal
          title="Delete test suite?"
          message={`"${pendingDelete.name}" will be removed. Test cases inside it are not deleted.`}
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}
    </div>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="rounded bg-warning-soft px-0.5 text-text">
        {p}
      </mark>
    ) : (
      <span key={i}>{p}</span>
    ),
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

interface SuiteRowProps {
  suite: Suite;
  search: string;
  writable: boolean;
  onEdit: () => void;
  onDelete: () => void;
}

function SuiteRow({ suite, search, writable, onEdit, onDelete }: SuiteRowProps) {
  const desc = suite.description ?? '';
  const descSlice = desc.length > 120 ? `${desc.slice(0, 120)}…` : desc;
  const count = suite.test_case_ids.length;
  return (
    <li
      data-cy="suite-row"
      data-suite-id={suite.id}
      className="group transition-colors hover:bg-surface-hover"
    >
      <div className="flex items-start justify-between gap-4 px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
              <Icon.Suites size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <Link
                to={`/suites/${suite.id}`}
                data-cy="suite-name-link"
                className="block truncate font-medium text-text transition-colors hover:text-brand"
              >
                {highlight(suite.name, search)}
              </Link>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
                <span
                  data-cy="suite-case-count"
                  className="inline-flex items-center gap-1.5"
                >
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-brand" />
                  {count} test case{count === 1 ? '' : 's'}
                </span>
                {descSlice && (
                  <>
                    <span className="text-text-tertiary">·</span>
                    <span data-cy="suite-description" className="truncate">
                      {highlight(descSlice, search)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2 opacity-0 transition-opacity group-hover:opacity-100">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-cy="suite-edit-btn"
            data-writable="true"
            hidden={!writable}
            onClick={onEdit}
            leftIcon={<Icon.Edit size={12} />}
          >
            Edit
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-cy="suite-delete-btn"
            data-writable="true"
            hidden={!writable}
            onClick={onDelete}
            title="Delete"
            aria-label="Delete"
            className="!text-danger-text hover:!bg-danger-soft"
          >
            <Icon.X size={14} />
          </Button>
        </div>
      </div>
    </li>
  );
}
