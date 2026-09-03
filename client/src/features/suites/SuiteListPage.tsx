// The Test Suites list page.
//
// Brings together the toolbar (search + sort), the inline create/edit
// form, the suite list, and the delete-confirm modal. State is local;
// data comes from TanStack Query (`useSuites` + `useCases`); mutations
// are optimistic on the cache.
//
// URL sync: search + sort are reflected in the query string so links
// are shareable and so the Cypress UI tests can assert on the URL
// after chip clicks.

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';

import { ConfirmModal } from '@/components/Modal';
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
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Test Suites</h2>
          <p className="text-sm text-gray-500">Group related test cases into reusable suites</p>
        </div>
        <button
          type="button"
          data-cy="suite-new-btn"
          data-writable
          hidden={!writable}
          onClick={openCreate}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New Test Suite
        </button>
      </div>

      <div data-cy="toolbar" className="mb-3 space-y-2 rounded border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <label htmlFor="suite-search" className="w-16 text-xs text-gray-600">
            Search
          </label>
          <input
            id="suite-search"
            type="search"
            data-cy="search-input"
            placeholder="Search suite names or descriptions…"
            autoComplete="off"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <button
            type="button"
            data-cy="clear-search-btn"
            hidden={!search}
            onClick={() => setSearch('')}
            className="rounded border border-gray-300 px-2 py-1 text-xs hover:bg-gray-50"
          >
            Clear
          </button>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="suite-sort" className="w-16 text-xs text-gray-600">
            Sort by
          </label>
          <select
            id="suite-sort"
            data-cy="sort-select"
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {SORT_VALUES.map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div data-cy="result-count" className="mb-3 text-sm text-gray-700">
        Showing <strong data-cy="result-count-value">{visible.length}</strong> of{' '}
        <span data-cy="result-total">{suites.length}</span>
      </div>

      <form
        data-cy="suite-form"
        hidden={!formOpen}
        onSubmit={submitForm}
        className="mb-4 space-y-2 rounded border border-gray-200 bg-white p-3"
      >
        <h3 className="text-sm font-semibold">
          {editingId !== null ? 'Edit Test Suite' : 'New Test Suite'}
        </h3>
        <input
          name="name"
          data-cy="suite-name-input"
          placeholder="Suite name"
          required
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <textarea
          name="description"
          data-cy="suite-description-input"
          placeholder="Description"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
        <label className="block text-xs text-gray-700">
          Test cases (Ctrl/Cmd-click to select multiple)
          <select
            multiple
            size={8}
            data-cy="suite-cases-select"
            value={form.test_case_ids.map(String)}
            onChange={(e) => {
              const ids = Array.from(e.target.selectedOptions).map((o) => Number(o.value));
              setForm((f) => ({ ...f, test_case_ids: ids }));
            }}
            className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
          >
            {allCases.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </label>
        <div className="flex justify-end gap-2">
          <button
            type="submit"
            data-cy="suite-submit-btn"
            disabled={createM.isPending || updateM.isPending}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {editingId !== null ? 'Update' : 'Create'}
          </button>
          <button
            type="button"
            data-cy="suite-cancel-btn"
            onClick={closeForm}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </form>

      <ul data-cy="suite-list" className="divide-y divide-gray-100 rounded border border-gray-200 bg-white">
        {suites.length === 0 ? (
          <li
            data-cy="empty-no-suites"
            className="px-3 py-6 text-center text-sm text-gray-500"
          >
            No test suites yet. Click &quot;+ New Test Suite&quot; to create one.
          </li>
        ) : visible.length === 0 ? (
          <li data-cy="empty-no-matches" className="px-3 py-6 text-center text-sm text-gray-500">
            No suites match the current search.{' '}
            <button
              type="button"
              data-cy="reset-filters"
              onClick={resetFilters}
              className="ml-2 rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
            >
              Reset
            </button>
          </li>
        ) : (
          visible.map((s) => (
            <SuiteRow
              key={s.id}
              suite={s}
              search={debouncedSearch}
              writable={writable}
              onEdit={() => openEdit(s)}
              onDelete={() => setPendingDelete(s)}
            />
          ))
        )}
      </ul>

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
    </section>
  );
}

function highlight(text: string, q: string) {
  if (!q) return text;
  const re = new RegExp(`(${escapeRegExp(q)})`, 'gi');
  const parts = text.split(re);
  return parts.map((p, i) =>
    i % 2 === 1 ? (
      <mark key={i} className="bg-yellow-100">
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
  const descSlice = desc.length > 60 ? `${desc.slice(0, 60)}…` : desc;
  const count = suite.test_case_ids.length;
  return (
    <li data-cy="suite-row" data-suite-id={suite.id} className="p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-sm font-medium">
            <Link
              to={`/suites/${suite.id}`}
              data-cy="suite-name-link"
              className="text-inherit no-underline hover:underline"
            >
              {highlight(suite.name, search)}
            </Link>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-600">
            <span data-cy="suite-case-count">
              {count} test case{count === 1 ? '' : 's'}
            </span>
            {descSlice && (
              <>
                <span>·</span>
                <span data-cy="suite-description">{highlight(descSlice, search)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            data-cy="suite-edit-btn"
            data-writable
            hidden={!writable}
            onClick={onEdit}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
          >
            Edit
          </button>
          <button
            type="button"
            data-cy="suite-delete-btn"
            data-writable
            hidden={!writable}
            onClick={onDelete}
            title="Delete"
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
          >
            ×
          </button>
        </div>
      </div>
    </li>
  );
}
