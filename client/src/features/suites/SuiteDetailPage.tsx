// The Suite detail page (/suites/:id).
//
// Mirrors public/suite-detail.html UX. Shows suite name + description,
// stat grid (cases in suite / passed / failed / not run), the member
// cases list with a cycle-run button per row, an add-case toolbar, and
// the Run-All action. Confirmation modal for remove + run-all.

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ConfirmModal } from '@/components/Modal';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import { useCases } from '@/features/cases/hooks';
import { useUpdateCase } from '@/features/cases/hooks';
import type { CaseData } from '@/features/cases/api';

import type { Suite } from './api';
import { useRunSuite, useSuite, useUpdateSuite } from './hooks';

type PendingAction =
  | { kind: 'remove'; caseId: number }
  | { kind: 'run-all' }
  | null;

export function SuiteDetailPage() {
  const { id: idStr } = useParams();
  const suiteId = Number(idStr);
  const { user } = useAuth();

  const suiteQ = useSuite(suiteId);
  const casesQ = useCases();
  const updateSuiteM = useUpdateSuite();
  const runM = useRunSuite(suiteId);
  const updateCaseM = useUpdateCase();

  const [pendingAddId, setPendingAddId] = useState<number>(0);
  const [pending, setPending] = useState<PendingAction>(null);

  const suite: Suite | undefined = suiteQ.data;
  const allCases: CaseData[] = casesQ.data ?? [];
  const writable = user?.role !== 'viewer';

  const memberCases = useMemo(() => {
    if (!suite) return [];
    return suite.test_case_ids
      .map((cid) => allCases.find((c) => c.id === cid))
      .filter((c): c is CaseData => Boolean(c));
  }, [suite, allCases]);

  const stats = useMemo(() => {
    const passed = memberCases.filter((c) => c.result === 'passed').length;
    const failed = memberCases.filter((c) => c.result === 'failed').length;
    const notRun = memberCases.filter((c) => c.result === 'not_run').length;
    return { passed, failed, notRun, total: memberCases.length };
  }, [memberCases]);

  const candidates = useMemo(() => {
    if (!suite) return [];
    const have = new Set(suite.test_case_ids);
    return allCases.filter((c) => !have.has(c.id));
  }, [suite, allCases]);

  const cycleResult = (cur: CaseData['result']): CaseData['result'] =>
    cur === 'not_run' ? 'passed' : cur === 'passed' ? 'failed' : 'not_run';

  const onCycleRun = async (c: CaseData) => {
    try {
      await updateCaseM.mutateAsync({ id: c.id, input: { result: cycleResult(c.result) } });
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    }
  };

  const onAddCase = async () => {
    if (!suite || !pendingAddId) return;
    try {
      await updateSuiteM.mutateAsync({
        id: suiteId,
        input: { test_case_ids: [...suite.test_case_ids, pendingAddId] },
      });
      setPendingAddId(0);
      showToast({ message: 'Added to suite', variant: 'success' });
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    }
  };

  const onRemoveCase = async (caseId: number) => {
    if (!suite) return;
    try {
      await updateSuiteM.mutateAsync({
        id: suiteId,
        input: { test_case_ids: suite.test_case_ids.filter((id) => id !== caseId) },
      });
      showToast({ message: 'Removed from suite', variant: 'success' });
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    }
  };

  const onRunAll = async () => {
    try {
      const result = await runM.mutateAsync();
      showToast({
        message: `Marked ${result.updated} test case${result.updated === 1 ? '' : 's'} as passed`,
        variant: 'success',
      });
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    }
  };

  if (!suite) {
    return (
      <section>
        <p className="text-sm text-gray-500">Loading suite…</p>
      </section>
    );
  }

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <Link
            to="/suites"
            data-cy="back-to-suites"
            className="text-xs text-blue-600 hover:underline"
          >
            ← Back to suites
          </Link>
          <h2 data-cy="suite-name" className="text-2xl font-semibold">
            {suite.name}
          </h2>
          {suite.description && (
            <p data-cy="suite-description" className="text-sm text-gray-500">
              {suite.description}
            </p>
          )}
        </div>
        <button
          type="button"
          data-cy="run-all-btn"
          data-writable
          hidden={!writable}
          disabled={runM.isPending || memberCases.length === 0}
          onClick={() => setPending({ kind: 'run-all' })}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          ▶ Run All (mark passed)
        </button>
      </div>

      <div data-cy="suite-stats" className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-4">
        <StatTile cy="stat-suite-case-count" label="Cases in suite" value={stats.total} />
        <StatTile cy="stat-suite-passed" label="Passed" value={stats.passed} />
        <StatTile cy="stat-suite-failed" label="Failed" value={stats.failed} />
        <StatTile cy="stat-suite-notrun" label="Not run" value={stats.notRun} />
      </div>

      <div data-cy="add-cases-toolbar" className="mb-4 rounded border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <label htmlFor="add-case-select" className="text-xs text-gray-600">
            Add test cases to this suite
          </label>
          <select
            id="add-case-select"
            data-cy="add-case-select"
            value={pendingAddId}
            onChange={(e) => setPendingAddId(Number(e.target.value))}
            disabled={!writable}
            className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm"
          >
            <option value={0}>— pick a test case —</option>
            {candidates.length === 0 ? (
              <option value={0} disabled>
                — no more test cases to add —
              </option>
            ) : (
              candidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))
            )}
          </select>
          <button
            type="button"
            data-cy="add-case-btn"
            disabled={!writable || !pendingAddId || updateSuiteM.isPending}
            onClick={onAddCase}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      </div>

      <ul
        data-cy="suite-cases-list"
        className="divide-y divide-gray-100 rounded border border-gray-200 bg-white"
      >
        {memberCases.length === 0 ? (
          <li
            data-cy="empty-no-cases-in-suite"
            className="px-3 py-6 text-center text-sm text-gray-500"
          >
            No test cases in this suite yet. Add some using the toolbar above.
          </li>
        ) : (
          memberCases.map((c) => (
            <li key={c.id} data-cy="suite-case-row" data-case-id={c.id} className="p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 data-cy="suite-case-title" className="text-sm font-medium">
                    {c.title}
                  </h3>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                    <span className={`rounded px-1.5 py-0.5 status-${c.status}`}>
                      {c.status}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 priority-${c.priority ?? 'medium'}`}>
                      {c.priority ?? 'medium'}
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    data-cy="suite-case-run-btn"
                    data-writable
                    hidden={!writable}
                    onClick={() => onCycleRun(c)}
                    disabled={updateCaseM.isPending}
                    className={`rounded px-2 py-0.5 text-xs result-${c.result}`}
                  >
                    {c.result.replace('_', ' ')}
                  </button>
                  <button
                    type="button"
                    data-cy="remove-case-btn"
                    data-writable
                    hidden={!writable}
                    onClick={() => setPending({ kind: 'remove', caseId: c.id })}
                    title="Remove from suite"
                    className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
                  >
                    ×
                  </button>
                </div>
              </div>
            </li>
          ))
        )}
      </ul>

      {pending?.kind === 'remove' && (
        <ConfirmModal
          title="Remove from suite?"
          message="The test case will be removed from this suite (but not deleted)."
          confirmLabel="Remove"
          danger
          onConfirm={() => {
            const cid = pending.caseId;
            setPending(null);
            void onRemoveCase(cid);
          }}
          onCancel={() => setPending(null)}
        />
      )}

      {pending?.kind === 'run-all' && (
        <ConfirmModal
          title="Run suite?"
          message={`Mark all ${memberCases.length} test case${memberCases.length === 1 ? '' : 's'} as passed.`}
          confirmLabel="Run"
          onConfirm={() => {
            setPending(null);
            void onRunAll();
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </section>
  );
}

function StatTile({ cy, label, value }: { cy: string; label: string; value: number }) {
  return (
    <div className="rounded border border-gray-200 bg-white p-3">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div data-cy={cy} className="my-1 text-2xl font-semibold">
        {value}
      </div>
    </div>
  );
}
