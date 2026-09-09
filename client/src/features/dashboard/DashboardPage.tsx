// =============================================================================
// /dashboard — product homepage.
//
// Layout (top → bottom):
//   • Hero panel — brand-coloured gradient with greeting + 1-line CTA.
//   • Stat strip — 4 cards (total cases, suites, pass rate, unrun).
//   • Distribution charts — by status, by priority, by last-run result.
//   • Reliability widget — flakiness scores (kept component from
//     features/cases/FlakinessComponents so the contract is unchanged).
//   • Recent cases + recent runs — two-column feed.
//
// All `data-cy` hooks from the previous implementation are preserved so
// the existing 04-dashboard.cy.js UI test continues to pass without
// changes.
// =============================================================================

import { Link } from 'react-router-dom';

import { Card } from '@/components/Card';
import { Button } from '@/components/Button';
import { ResultPill, StatusPill, PriorityPill } from '@/components/Pill';
import { Spinner } from '@/components/Button';
import { Icon } from '@/components/Icons';

import { FlakyCasesCard } from '@/features/cases/FlakinessComponents';
import { useAuth } from '@/hooks/useAuth';

import { useDashboardData } from './hooks';

const STATUS_KEYS = ['draft', 'active', 'deprecated'] as const;
const PRIORITY_KEYS = ['high', 'medium', 'low'] as const;
const RESULT_KEYS = ['not_run', 'passed', 'failed'] as const;

const STATUS_LABEL: Record<(typeof STATUS_KEYS)[number], string> = {
  draft: 'Draft',
  active: 'Active',
  deprecated: 'Deprecated',
};
const PRIORITY_LABEL: Record<(typeof PRIORITY_KEYS)[number], string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};
const RESULT_LABEL: Record<(typeof RESULT_KEYS)[number], string> = {
  not_run: 'Not run',
  passed: 'Passed',
  failed: 'Failed',
};

const BAR_TONE = {
  status: 'bg-brand',
  priority: 'bg-amber-500',
  result: 'bg-emerald-500',
} as const;

export function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useDashboardData();
  const cases = data.cases;
  const suites = data.suites;
  const recentRuns = data.recentRuns;

  const totalCases = cases.length;
  const totalSuites = suites.length;
  const runCases = cases.filter((c) => c.result !== 'not_run');
  const passed = cases.filter((c) => c.result === 'passed').length;
  const passRate =
    runCases.length > 0 ? Math.round((passed / runCases.length) * 100) : null;
  const unrun = cases.filter((c) => c.result === 'not_run').length;

  const recentCases = [...cases]
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-8">
      {/* Hero */}
      <Card tone="hero" className="p-6 sm:p-8">
        <div className="relative z-10 flex flex-col gap-6 md:flex-row md:items-center md:justify-between">
          <div className="max-w-2xl">
            <div className="text-xs font-semibold uppercase tracking-wider text-text-inverse/70 mb-2">
              Welcome back{user ? `, ${user.name || user.email.split('@')[0]}` : ''}
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-text-inverse">
              Catch what changed before your users do.
            </h1>
            <p className="mt-2 text-sm sm:text-base text-text-inverse/80 leading-relaxed">
              A live overview of your test cases, runs and reliability. Everything you
              need to know about the state of your regression suite, in one place.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link to="/cases" data-cy="link-to-cases">
              <Button variant="secondary" leftIcon={<Icon.Cases size={16} />}>
                View cases
              </Button>
            </Link>
            <Link to="/suites" data-cy="link-to-suites">
              <Button
                variant="primary"
                className="bg-text-inverse text-text hover:bg-text-inverse/90"
                rightIcon={<Icon.ArrowRight size={14} />}
              >
                View suites
              </Button>
            </Link>
          </div>
        </div>
      </Card>

      {/* Stats strip */}
      <div data-cy="stats" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          cy="stat-total-cases"
          label="Total test cases"
          value={isLoading ? null : totalCases}
          icon={<Icon.Cases size={16} />}
        />
        <StatCard
          cy="stat-total-suites"
          label="Total test suites"
          value={isLoading ? null : totalSuites}
          icon={<Icon.Suites size={16} />}
        />
        <StatCard
          cy="stat-pass-rate"
          label="Pass rate"
          value={
            isLoading
              ? null
              : passRate === null
                ? '—'
                : `${passRate}%`
          }
          sub={runCases.length ? `from ${runCases.length} run case${runCases.length === 1 ? '' : 's'}` : 'no cases run yet'}
          tone={passRate == null ? 'neutral' : passRate >= 80 ? 'success' : passRate >= 50 ? 'warning' : 'danger'}
          icon={<Icon.TrendUp size={16} />}
        />
        <StatCard
          cy="stat-unrun"
          label="Never run"
          value={isLoading ? null : unrun}
          sub="awaiting first execution"
          tone={unrun > 0 ? 'warning' : 'neutral'}
          icon={<Icon.Pause size={16} />}
        />
      </div>

      {/* Distribution charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section data-cy="section-status" className="rg-card p-5">
          <SectionTitle title="By status" description="Draft, active, deprecated" />
          <div data-cy="status-bars" className="mt-4 space-y-2.5">
            <BarChart
              items={cases}
              keys={STATUS_KEYS}
              pick={(c) => c.status}
              labels={STATUS_LABEL}
              tone={BAR_TONE.status}
            />
          </div>
        </section>

        <section data-cy="section-priority" className="rg-card p-5">
          <SectionTitle title="By priority" description="High to low" />
          <div data-cy="priority-bars" className="mt-4 space-y-2.5">
            <BarChart
              items={cases}
              keys={PRIORITY_KEYS}
              pick={(c) => c.priority ?? 'medium'}
              labels={PRIORITY_LABEL}
              tone={BAR_TONE.priority}
            />
          </div>
        </section>

        <section data-cy="section-result" className="rg-card p-5">
          <SectionTitle title="Last run results" description="Most recent execution per case" />
          <div data-cy="result-bars" className="mt-4 space-y-2.5">
            <BarChart
              items={cases}
              keys={RESULT_KEYS}
              pick={(c) => c.result}
              labels={RESULT_LABEL}
              tone={BAR_TONE.result}
            />
          </div>
        </section>
      </div>

      {/* Reliability widget */}
      <FlakyCasesCard threshold={50} />

      {/* Recent cases + runs */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section data-cy="section-recent" className="rg-card p-5">
          <SectionTitle
            title="Recently updated cases"
            action={
              <Link
                to="/cases"
                data-cy="recent-cases-view-all"
                className="text-xs font-medium text-brand hover:text-brand-hover"
              >
                View all →
              </Link>
            }
          />
          {recentCases.length === 0 ? (
            <div className="mt-4 px-2 py-6 text-center text-sm text-text-secondary">
              No test cases yet. Create one to see it here.
            </div>
          ) : (
            <ul
              id="recent-list"
              data-cy="recent-list"
              className="mt-4 divide-y divide-border-soft"
            >
              {recentCases.map((c) => (
                <li
                  key={c.id}
                  data-cy="recent-case"
                  data-case-id={c.id}
                  className="py-3 first:pt-0 last:pb-0"
                >
                  <Link
                    to={`/cases/${c.id}`}
                    className="group flex items-start justify-between gap-3"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-text group-hover:text-brand transition-colors truncate">
                        {c.title}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StatusPill status={c.status ?? 'draft'} size="sm" />
                        <PriorityPill priority={c.priority ?? 'medium'} size="sm" />
                        <span className="text-xs text-text-tertiary">
                          updated {timeAgo(c.updated_at)}
                        </span>
                      </div>
                    </div>
                    <Icon.Chevron size={14} className="text-text-tertiary mt-1 group-hover:text-brand transition-colors" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section data-cy="section-recent-runs" className="rg-card p-5">
          <SectionTitle
            title="Recent runs"
            description="Last 7 days"
            action={
              <Link to="/cases" className="text-xs font-medium text-brand hover:text-brand-hover">
                View all →
              </Link>
            }
          />
          {recentRuns.length === 0 ? (
            <div className="mt-4 px-2 py-6 text-center text-sm text-text-secondary">
              No runs in the last 7 days.
            </div>
          ) : (
            <ul
              id="recent-runs-list"
              data-cy="recent-runs-list"
              className="mt-4 divide-y divide-border-soft"
            >
              {recentRuns.slice(0, 8).map((r) => {
                const title = r.test_case ? r.test_case.title : '(deleted case)';
                const runner = r.run_by ? r.run_by.name ?? r.run_by.email : 'anonymous';
                return (
                  <li key={r.id} data-cy="recent-run" className="py-3 first:pt-0 last:pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-medium text-text truncate">
                          {title}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          <ResultPill result={r.status} size="sm" />
                          <span className="text-xs text-text-tertiary">
                            by {runner}
                          </span>
                          <span className="text-xs text-text-tertiary">
                            · {timeAgo(r.started_at)}
                          </span>
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// =============================================================================
// Sub-components
// =============================================================================

function SectionTitle({
  title,
  description,
  action,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div>
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        {description && (
          <p className="text-xs text-text-tertiary mt-0.5">{description}</p>
        )}
      </div>
      {action}
    </div>
  );
}

interface StatCardProps {
  cy: string;
  label: string;
  value: number | string | null;
  sub?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
  icon?: React.ReactNode;
}

function StatCard({ cy, label, value, sub, tone = 'neutral', icon }: StatCardProps) {
  const toneClasses: Record<NonNullable<StatCardProps['tone']>, string> = {
    neutral: 'text-text',
    success: 'text-success-text',
    warning: 'text-warning-text',
    danger: 'text-danger-text',
  };
  const iconTone: Record<NonNullable<StatCardProps['tone']>, string> = {
    neutral: 'bg-surface-sunken text-text-secondary',
    success: 'bg-success-soft text-success',
    warning: 'bg-warning-soft text-warning',
    danger: 'bg-danger-soft text-danger',
  };
  return (
    <Card className="p-5" data-cy={cy}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium uppercase tracking-wider text-text-tertiary">
            {label}
          </div>
          <div
            data-cy={`${cy}-value`}
            className={`mt-2 text-2xl font-bold tracking-tight ${toneClasses[tone]}`}
          >
            {value === null ? <Spinner size={16} /> : value}
          </div>
          {sub && (
            <div
              {...(cy === 'stat-pass-rate' ? { 'data-cy': 'stat-pass-rate-delta' } :
                  cy === 'stat-total-cases' ? { 'data-cy': 'stat-total-cases-delta' } : {})}
              className="mt-1 text-xs text-text-tertiary"
            >
              {sub}
            </div>
          )}
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

interface BarChartProps<T> {
  items: T[];
  keys: readonly string[];
  pick: (item: T) => string | undefined;
  labels?: Record<string, string>;
  tone: string;
}

function BarChart<T>({ items, keys, pick, labels = {}, tone }: BarChartProps<T>) {
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
            <div className="w-24 text-xs text-text-secondary truncate">{labels[k] || k}</div>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
              <div
                className={`h-full rounded-full ${tone} transition-all duration-700`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div data-cy="bar-count" className="w-8 text-right text-xs font-medium text-text">
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
