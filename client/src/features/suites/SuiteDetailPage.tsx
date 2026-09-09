// The Suite detail page (/suites/:id).
//
// Layout:
//   • Breadcrumb + header with name, description, "Run all" CTA
//   • 4 stat tiles (cases / passed / failed / not run)
//   • Add-cases toolbar (select + Add button)
//   • Member cases list with cycle-run + remove per row

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';

import { ConfirmModal } from '@/components/Modal';
import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { Pill, ResultPill, StatusPill, PriorityPill } from '@/components/Pill';
import { Icon } from '@/components/Icons';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import { useCases, useUpdateCase } from '@/features/cases/hooks';
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
  const [addSearch, setAddSearch] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const [pending, setPending] = useState<PendingAction>(null);

  // Close the picker dropdown on outside click.
  useEffect(() => {
    if (!pickerOpen) return;
    function onDocDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    }
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [pickerOpen]);

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

  const filteredCandidates = useMemo(() => {
    const q = addSearch.trim().toLowerCase();
    if (!q) return candidates;
    return candidates.filter((c) => {
      if (c.title.toLowerCase().includes(q)) return true;
      if ((c.description ?? '').toLowerCase().includes(q)) return true;
      if ((c.tags ?? []).some((t) => t.toLowerCase().includes(q))) return true;
      return false;
    });
  }, [candidates, addSearch]);

  const selectedCandidate = pendingAddId
    ? candidates.find((c) => c.id === pendingAddId) ?? null
    : null;

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
      setAddSearch('');
      setPickerOpen(false);
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
      <div className="flex items-center justify-center py-16 text-sm text-text-secondary">
        <span className="rg-spin inline-block h-4 w-4 mr-2 rounded-full border-2 border-brand border-t-transparent" />
        Loading suite…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav className="flex items-center gap-2 text-xs">
        <Link
          to="/suites"
          data-cy="back-to-suites"
          className="inline-flex items-center gap-1 text-text-secondary hover:text-text"
        >
          <Icon.Chevron size={12} className="rotate-180" />
          All suites
        </Link>
        <span className="text-text-tertiary">/</span>
        <span className="text-text-secondary">{suite.name}</span>
      </nav>

      {/* Header */}
      <Card className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-tertiary">
              <span className="rounded bg-surface-sunken px-2 py-0.5">Test suite</span>
              <span>#{suite.id}</span>
            </div>
            <h2 data-cy="suite-name" className="mt-2 text-2xl font-semibold tracking-tight text-text">
              {suite.name}
            </h2>
            {suite.description && (
              <p data-cy="suite-description" className="mt-1 text-sm text-text-secondary">
                {suite.description}
              </p>
            )}
          </div>
          <Button
            variant="brand"
            data-cy="run-all-btn"
            data-writable="true"
            hidden={!writable}
            disabled={runM.isPending || memberCases.length === 0}
            loading={runM.isPending}
            leftIcon={<Icon.Run size={14} />}
            onClick={() => setPending({ kind: 'run-all' })}
          >
            Run all
          </Button>
        </div>
      </Card>

      {/* Stat tiles */}
      <div data-cy="suite-stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatTile cy="stat-suite-case-count" label="Cases in suite" value={stats.total} icon={<Icon.Suites size={16} />} tone="neutral" />
        <StatTile cy="stat-suite-passed" label="Passed" value={stats.passed} icon={<Icon.Check size={16} />} tone="success" />
        <StatTile cy="stat-suite-failed" label="Failed" value={stats.failed} icon={<Icon.X size={16} />} tone="danger" />
        <StatTile cy="stat-suite-notrun" label="Not run" value={stats.notRun} icon={<Icon.Pause size={16} />} tone="warning" />
      </div>

      {/* Add-cases toolbar */}
      <Card className="p-4">
        <div data-cy="add-cases-toolbar" className="flex flex-wrap items-center gap-2">
          <label htmlFor="add-case-search" className="text-sm font-medium text-text-secondary">
            Add test cases
          </label>
          <div ref={pickerRef} className="relative flex-1 min-w-[240px]">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary">
              <Icon.Search size={14} />
            </span>
            <input
              id="add-case-search"
              data-cy="add-case-search"
              type="search"
              autoComplete="off"
              placeholder={
                candidates.length === 0
                  ? 'No more test cases to add'
                  : 'Type to search…'
              }
              disabled={!writable || candidates.length === 0}
              value={selectedCandidate ? selectedCandidate.title : addSearch}
              onFocus={() => setPickerOpen(true)}
              onChange={(e) => {
                setPendingAddId(0);
                setAddSearch(e.target.value);
                setPickerOpen(true);
              }}
              className="rg-input pl-9"
            />
            {pickerOpen && candidates.length > 0 && (
              <ul
                data-cy="add-case-options"
                className="absolute z-30 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-border bg-surface shadow-card"
              >
                {filteredCandidates.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-text-secondary">
                    No test cases match “{addSearch}”.
                  </li>
                ) : (
                  filteredCandidates.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        data-cy="add-case-option"
                        data-id={c.id}
                        onClick={() => {
                          setPendingAddId(c.id);
                          setAddSearch('');
                          setPickerOpen(false);
                        }}
                        className={`flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-surface-hover ${
                          pendingAddId === c.id ? 'bg-brand-soft' : ''
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-text">{c.title}</div>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[11px] text-text-tertiary">
                            <StatusPill status={c.status ?? 'draft'} size="sm" />
                            <PriorityPill priority={c.priority ?? 'medium'} size="sm" />
                            {(c.tags ?? []).slice(0, 3).map((t) => (
                              <Pill key={t} tone="brand" size="sm" className="!py-0">
                                #{t}
                              </Pill>
                            ))}
                          </div>
                        </div>
                      </button>
                    </li>
                  ))
                )}
              </ul>
            )}
          </div>
          <Button
            variant="secondary"
            data-cy="add-case-btn"
            disabled={!writable || !pendingAddId || updateSuiteM.isPending}
            onClick={onAddCase}
            leftIcon={<Icon.Plus size={14} />}
          >
            Add
          </Button>
        </div>
      </Card>

      {/* Member cases */}
      <Card className="overflow-hidden">
        {memberCases.length === 0 ? (
          <div
            data-cy="empty-no-cases-in-suite"
            className="px-6 py-12 text-center text-sm text-text-secondary"
          >
            No test cases in this suite yet. Add some using the toolbar above.
          </div>
        ) : (
          <ul data-cy="suite-cases-list" className="divide-y divide-border-soft">
            {memberCases.map((c) => (
              <li
                key={c.id}
                data-cy="suite-case-row"
                data-case-id={c.id}
                className="group transition-colors hover:bg-surface-hover"
              >
                <div className="flex items-start gap-4 px-4 py-3.5">
                  <Link
                    to={`/cases/${c.id}`}
                    data-cy="suite-case-title"
                    className="min-w-0 flex-1"
                  >
                    <div className="text-sm font-medium text-text group-hover:text-brand transition-colors break-words">
                      {c.title}
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      <StatusPill status={c.status ?? 'draft'} size="sm" />
                      <PriorityPill priority={c.priority ?? 'medium'} size="sm" />
                    </div>
                  </Link>
                  <button
                    type="button"
                    data-cy="suite-case-run-btn"
                    data-writable="true"
                    hidden={!writable}
                    onClick={() => onCycleRun(c)}
                    disabled={updateCaseM.isPending}
                    className={`result-${c.result}`}
                  >
                    <ResultPill result={c.result} size="sm" />
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    data-cy="remove-case-btn"
                    data-writable="true"
                    hidden={!writable}
                    onClick={() => setPending({ kind: 'remove', caseId: c.id })}
                    title="Remove from suite"
                    aria-label="Remove from suite"
                    className="!text-danger-text hover:!bg-danger-soft"
                  >
                    <Icon.X size={14} />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

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
    </div>
  );
}

function StatTile({
  cy,
  label,
  value,
  icon,
  tone = 'neutral',
}: {
  cy: string;
  label: string;
  value: number;
  icon?: React.ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}) {
  const toneClasses: Record<typeof tone, string> = {
    neutral: 'text-text',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
  };
  const iconTone: Record<typeof tone, string> = {
    neutral: 'bg-surface-sunken text-text-secondary',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  };
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-xs font-medium uppercase tracking-wider text-text-tertiary">{label}</div>
          <div data-cy={cy} className={`mt-2 text-2xl font-bold tracking-tight ${toneClasses[tone]}`}>{value}</div>
        </div>
        {icon && (
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${iconTone[tone]}`}>
            {icon}
          </div>
        )}
      </div>
    </Card>
  );
}
