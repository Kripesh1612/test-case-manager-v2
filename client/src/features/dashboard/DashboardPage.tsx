// /dashboard — at-a-glance overview.
//
// Three data sources (cases, suites, recent runs) are loaded in
// parallel via useDashboardData(). The page renders stat cards (totals
// + pass rate), three bar-chart sections (status / priority / result),
// the 5 most-recently-updated cases, and the last 7 days of runs.
//
// Mirrors public/dashboard.html UX. data-cy attrs match what
// ui/04-dashboard.cy.js expects.

import { Link } from 'react-router-dom';

import { FlakyCasesCard } from '@/features/cases/FlakinessComponents';

import { useDashboardData } from './hooks';

const STATUS_KEYS = ['draft', 'active', 'deprecated'] as const;
const PRIORITY_KEYS = ['high', 'medium', 'low'] as const;
const RESULT_KEYS = ['not_run', 'passed', 'failed'] as const;

const RESULT_LABELS: Record<(typeof RESULT_KEYS)[number], string> = {
  not_run: 'Not run',
  passed: 'Passed',
  failed: 'Failed',
};

export function DashboardPage() {
  const { data, isLoading } = useDashboardData();
  const cases = data.cases;
  const suites = data.suites;
  const recentRuns = data.recentRuns;

  // Stat-card math
  const totalCases = cases.length;
  const totalSuites = suites.length;
  const runCases = cases.filter((c) => c.result !== 'not_run');
  const passed = cases.filter((c) => c.result === 'passed').length;
  const passRate =
    runCases.length > 0 ? Math.round((passed / runCases.length) * 100) : null;
  const unrun = cases.filter((c) => c.result === 'not_run').length;

  // Recent cases — top 5 by updated_at desc
  const recentCases = [...cases]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  return (
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Dashboard</h2>
          <p className="text-sm text-gray-500">Overview of your test suite</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/cases"
            data-cy="link-to-cases"
            className="rounded border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50"
          >
            View Cases →
          </Link>
          <Link
            to="/suites"
            data-cy="link-to-suites"
            className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            View Suites →
          </Link>
        </div>
      </div>

      <div data-cy="stats" className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          cy="stat-total-cases"
          label="Total test cases"
          value={isLoading ? '–' : totalCases}
          delta="—"
          deltaCy="stat-total-cases-delta"
        />
        <StatCard
          cy="stat-total-suites"
          label="Total test suites"
          value={isLoading ? '–' : totalSuites}
          delta="groupings of related tests"
        />
        <StatCard
          cy="stat-pass-rate"
          label="Pass rate (run cases)"
          value={isLoading ? '–' : passRate === null ? '—' : `${passRate}%`}
          delta={
            runCases.length
              ? `from ${runCases.length} run case${runCases.length === 1 ? '' : 's'}`
              : 'no cases run yet'
          }
          deltaCy="stat-pass-rate-delta"
        />
        <StatCard
          cy="stat-unrun"
          label="Never run"
          value={isLoading ? '–' : unrun}
          delta="awaiting first execution"
        />
      </div>

      <section data-cy="section-status" className="mb-6 rounded border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">By status</h3>
        <div data-cy="status-bars" className="space-y-2">
          <BarChart items={cases} keys={STATUS_KEYS} pick={(c) => c.status} />
        </div>
      </section>

      <section data-cy="section-priority" className="mb-6 rounded border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">By priority</h3>
        <div data-cy="priority-bars" className="space-y-2">
          <BarChart items={cases} keys={PRIORITY_KEYS} pick={(c) => c.priority ?? 'medium'} />
        </div>
      </section>

      <section data-cy="section-result" className="mb-6 rounded border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">Last run results</h3>
        <div data-cy="result-bars" className="space-y-2">
          <BarChart
            items={cases}
            keys={RESULT_KEYS}
            pick={(c) => c.result}
            labels={RESULT_LABELS}
          />
        </div>
      </section>

      <div className="mb-6">
        <FlakyCasesCard threshold={50} />
      </div>

      <section data-cy="section-recent" className="mb-6 rounded border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">Recently updated test cases</h3>
        {recentCases.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-gray-500">
            No test cases yet. Create one to see it here.
          </div>
        ) : (
          <ul id="recent-list" data-cy="recent-list" className="divide-y divide-gray-100">
            {recentCases.map((c) => (
              <li
                key={c.id}
                data-cy="recent-case"
                data-case-id={c.id}
                className="py-2"
              >
                <div className="flex flex-col gap-1">
                  <h3>
                    <Link
                      to={`/cases?q=${encodeURIComponent(c.title)}`}
                      className="text-inherit no-underline hover:underline"
                    >
                      {c.title}
                    </Link>
                  </h3>
                  <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                    <span className={`rounded px-1.5 py-0.5 status-${c.status}`}>
                      {c.status}
                    </span>
                    <span className={`rounded px-1.5 py-0.5 priority-${c.priority ?? 'medium'}`}>
                      {c.priority ?? 'medium'}
                    </span>
                    <span>updated {timeAgo(c.updated_at)}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section data-cy="section-recent-runs" className="rounded border border-gray-200 bg-white p-4">
        <h3 className="mb-3 text-sm font-semibold">
          Recent runs <span className="text-xs font-normal text-gray-500">(last 7 days)</span>
        </h3>
        {recentRuns.length === 0 ? (
          <div className="px-2 py-4 text-center text-sm text-gray-500">
            No runs in the last 7 days.
          </div>
        ) : (
          <ul id="recent-runs-list" data-cy="recent-runs-list" className="divide-y divide-gray-100">
            {recentRuns.slice(0, 8).map((r) => {
              const title = r.test_case ? r.test_case.title : '(deleted case)';
              const runner = r.run_by ? r.run_by.name ?? r.run_by.email : 'anonymous';
              return (
                <li key={r.id} data-cy="recent-run" className="py-2">
                  <div className="flex flex-col gap-1">
                    <h3 className="text-sm font-medium">{title}</h3>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-gray-600">
                      <span className={`rounded px-1.5 py-0.5 result-${r.status}`}>{r.status}</span>
                      <span>by {runner}</span>
                      <span>{timeAgo(r.started_at)}</span>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </section>
  );
}

interface StatCardProps {
  cy: string;
  label: string;
  value: number | string;
  delta: string;
  deltaCy?: string;
}

function StatCard({ cy, label, value, delta, deltaCy }: StatCardProps) {
  return (
    <div data-cy={cy} className="rounded border border-gray-200 bg-white p-3">
      <div className="text-xs uppercase text-gray-500">{label}</div>
      <div data-cy={`${cy}-value`} className="my-1 text-2xl font-semibold">
        {value}
      </div>
      <div {...(deltaCy ? { 'data-cy': deltaCy } : {})} className="text-xs text-gray-500">
        {delta}
      </div>
    </div>
  );
}

interface BarChartProps<T> {
  items: T[];
  keys: readonly string[];
  pick: (item: T) => string | undefined;
  labels?: Record<string, string>;
}

function BarChart<T>({ items, keys, pick, labels = {} }: BarChartProps<T>) {
  const total = items.length || 1;
  return (
    <>
      {keys.map((k) => {
        const count = items.filter((it) => pick(it) === k).length;
        const pct = Math.round((count / total) * 100);
        return (
          <div
            key={k}
            data-cy="bar-row"
            data-key={k}
            className="flex items-center gap-3"
          >
            <div className="w-24 text-xs text-gray-700">{labels[k] || k}</div>
            <div className="h-3 flex-1 overflow-hidden rounded bg-gray-100">
              <div className="h-full bg-blue-500" style={{ width: `${pct}%` }} />
            </div>
            <div data-cy="bar-count" className="w-8 text-right text-xs text-gray-700">
              {count}
            </div>
          </div>
        );
      })}
    </>
  );
}

function timeAgo(iso: string): string {
  const d = new Date(iso);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} min ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hr ago`;
  const days = Math.floor(diff / 86400);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}