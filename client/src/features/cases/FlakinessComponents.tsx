// Flakiness UI: badge, panel, and dashboard card.
//
// Three presentation layers over the same data shape from /api.ts:
//
//   <FlakinessBadge>  — a one-line pill for the case list rows.
//                       Loads its own data via useFlakiness(caseId).
//                       Renders nothing until data resolves (so the list
//                       layout doesn't reflow on every row).
//
//   <FlakinessPanel>  — the full report for a case detail page. Shows
//                       score gauge, verdict, signals breakdown, and
//                       recent vs baseline window stats. Designed to sit
//                       beside the version-history panel.
//
//   <FlakyCasesCard>  — top-N dashboard widget fed by useFlakyList.
//
// All components share a single `verdictPalette()` so colour semantics
// stay consistent (green = stable, red = very_flaky/broken, amber for
// the uncertain middle). The score is rounded to a whole number when
// shown — the API may return one decimal place.

import { Link } from 'react-router-dom';

import { useFlakiness, useFlakyList } from './hooks';
import type { FlakinessReport, FlakinessVerdict } from './api';

// ---- Shared helpers ------------------------------------------------------

const VERDICT_LABEL: Record<FlakinessVerdict, string> = {
  stable: 'Stable',
  possibly_flaky: 'Possibly flaky',
  flaky: 'Flaky',
  very_flaky: 'Very flaky',
  broken: 'Regression',
  insufficient_data: 'Not enough data',
};

interface Palette {
  bg: string;
  text: string;
  border: string;
  dot: string;
}

function verdictPalette(verdict: FlakinessVerdict): Palette {
  switch (verdict) {
    case 'stable':
      return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' };
    case 'possibly_flaky':
      return { bg: 'bg-amber-50', text: 'text-amber-800', border: 'border-amber-200', dot: 'bg-amber-500' };
    case 'flaky':
      return { bg: 'bg-orange-50', text: 'text-orange-800', border: 'border-orange-200', dot: 'bg-orange-500' };
    case 'very_flaky':
      return { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-200', dot: 'bg-red-500' };
    case 'broken':
      return { bg: 'bg-rose-50', text: 'text-rose-900', border: 'border-rose-300', dot: 'bg-rose-600' };
    case 'insufficient_data':
    default:
      return { bg: 'bg-gray-50', text: 'text-gray-600', border: 'border-gray-200', dot: 'bg-gray-400' };
  }
}

// ---- FlakinessBadge (used in CaseListPage rows) --------------------------

interface FlakinessBadgeProps {
  caseId: number;
  /** When true the badge is hidden unless the case is genuinely flaky —
   *  saves space in dense lists. Default: always show. */
  onlyWhenInteresting?: boolean;
}

export function FlakinessBadge({ caseId, onlyWhenInteresting = false }: FlakinessBadgeProps) {
  const q = useFlakiness(caseId);
  // Don't pop in/out as the request resolves — render a fixed-size
  // placeholder so the row layout doesn't jitter.
  if (!q.data) {
    return <span data-cy={`flakiness-badge-${caseId}`} className="inline-block h-4 w-16" aria-hidden />;
  }
  const r = q.data;
  const verdict = r.verdict;
  if (onlyWhenInteresting && (verdict === 'stable' || verdict === 'insufficient_data')) {
    return null;
  }
  const palette = verdictPalette(verdict);
  const scoreLabel = r.score == null ? '—' : String(Math.round(r.score));
  return (
    <span
      data-cy={`flakiness-badge-${caseId}`}
      data-verdict={verdict}
      data-score={r.score ?? ''}
      title={`Flakiness: ${VERDICT_LABEL[verdict]} (score ${scoreLabel}/100, n=${r.sample_size})`}
      className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${palette.bg} ${palette.text} ${palette.border}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${palette.dot}`} />
      {VERDICT_LABEL[verdict]}
      {r.score != null && <span className="text-[10px] opacity-75">{scoreLabel}</span>}
    </span>
  );
}

// ---- FlakinessPanel (used in CaseDetailPage) -----------------------------

interface FlakinessPanelProps {
  caseId: number;
}

export function FlakinessPanel({ caseId }: FlakinessPanelProps) {
  const q = useFlakiness(caseId);

  return (
    <div data-cy="flakiness-panel" className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M3 12a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0-4a1 1 0 011-1h7a1 1 0 110 2H4a1 1 0 01-1-1zm0-4a1 1 0 011-1h4a1 1 0 110 2H4a1 1 0 01-1-1zm11.707 7.293a1 1 0 010 1.414l-3 3a1 1 0 01-1.414 0l-1-1a1 1 0 011.414-1.414L11 13.586l2.293-2.293a1 1 0 011.414 0z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900">Flakiness</h3>
        </div>
        <Link
          to={`/cases?q=flaky`}
          data-cy="flakiness-see-all"
          className="text-xs font-medium text-blue-600 hover:underline"
        >
          See all flaky →
        </Link>
      </div>

      <div className="p-5">
        {q.isLoading && <div className="text-sm text-gray-500">Computing…</div>}
        {q.error && (
          <div className="text-sm text-red-700">Could not load flakiness report.</div>
        )}
        {q.data && <FlakinessReportView report={q.data} />}
      </div>
    </div>
  );
}

function FlakinessReportView({ report }: { report: FlakinessReport }) {
  const palette = verdictPalette(report.verdict);
  const score = report.score == null ? 0 : report.score;
  const scoreDeg = Math.max(0, Math.min(100, score));
  const gaugeColor =
    report.verdict === 'stable'
      ? '#10b981'
      : report.verdict === 'possibly_flaky'
        ? '#f59e0b'
        : report.verdict === 'broken'
          ? '#be123c'
          : score >= 75
            ? '#ef4444'
            : '#f97316';

  return (
    <div className="space-y-4" data-cy="flakiness-report">
      {/* Verdict pill + score gauge */}
      <div className="flex flex-wrap items-center gap-4">
        <span
          data-cy="flakiness-verdict"
          data-verdict={report.verdict}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold ${palette.bg} ${palette.text} ${palette.border}`}
        >
          <span className={`h-2 w-2 rounded-full ${palette.dot}`} />
          {VERDICT_LABEL[report.verdict]}
        </span>

        <div className="flex items-center gap-2" aria-label="Flakiness score">
          <div className="relative h-3 w-40 overflow-hidden rounded-full bg-gray-100">
            <div
              className="h-full rounded-full"
              style={{ width: `${scoreDeg}%`, background: gaugeColor }}
            />
          </div>
          <span data-cy="flakiness-score" className="text-sm font-semibold text-gray-900">
            {report.score == null ? '—' : report.score.toFixed(1)}
            <span className="text-xs font-normal text-gray-500"> / 100</span>
          </span>
        </div>

        <span className="text-xs text-gray-500" data-cy="flakiness-sample-size">
          {report.sample_size} run{report.sample_size === 1 ? '' : 's'} in window
        </span>
      </div>

      {report.verdict === 'insufficient_data' && (
        <p className="rounded border border-dashed border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-600">
          At least 5 finished runs are needed to produce a verdict. Mark this case passed
          or failed a few more times and the score will appear.
        </p>
      )}

      {/* Signals */}
      <div>
        <h4 className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
          Signals
        </h4>
        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Signal
            label="Disagreement"
            value={report.signals.disagreement}
            note="Recent vs baseline pass-rate gap"
          />
          <Signal
            label="Switch rate"
            value={report.signals.switch_rate}
            note="Alternations in recent window"
          />
          <Signal
            label="Late failure"
            value={report.signals.late_failure}
            note="Last run failed after a streak"
            mono
          />
        </div>
      </div>

      {/* Window stats */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <WindowStats title="Recent" window={report.recent} accent="blue" />
        <WindowStats title="Baseline" window={report.baseline} accent="gray" />
      </div>

      {report.last_run_at && (
        <div className="text-xs text-gray-500" data-cy="flakiness-last-run">
          Last run {formatRel(report.last_run_at)} —
          <span
            className={`ml-1 font-medium ${
              report.last_run_status === 'passed' ? 'text-emerald-700' : 'text-red-700'
            }`}
          >
            {report.last_run_status}
          </span>
        </div>
      )}
    </div>
  );
}

interface SignalProps {
  label: string;
  value: number;
  note: string;
  mono?: boolean;
}

function Signal({ label, value, note, mono = false }: SignalProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex items-center justify-between text-[11px] font-semibold uppercase tracking-wider text-gray-600">
        <span>{label}</span>
        <span className={mono ? 'font-mono' : ''}>{mono ? value.toFixed(2) : `${pct}%`}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white">
        <div
          className={`h-full rounded-full ${pct >= 75 ? 'bg-red-500' : pct >= 50 ? 'bg-orange-500' : pct >= 25 ? 'bg-amber-400' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="mt-1 text-[10px] text-gray-500">{note}</div>
    </div>
  );
}

interface WindowStatsProps {
  title: string;
  window: { window_size: number; passed: number; failed: number; pass_rate: number };
  accent: 'blue' | 'gray';
}

function WindowStats({ title, window: w, accent }: WindowStatsProps) {
  const pct = Math.round(w.pass_rate * 100);
  const border = accent === 'blue' ? 'border-blue-200' : 'border-gray-200';
  const bg = accent === 'blue' ? 'bg-blue-50' : 'bg-gray-50';
  return (
    <div className={`rounded-md border ${border} ${bg} px-3 py-2`}>
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-gray-600">
          {title} window
        </span>
        <span className="text-xs text-gray-700">{w.window_size} runs</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white">
        <div
          className="h-full rounded-full bg-emerald-500"
          style={{ width: `${pct}%` }}
          aria-label={`${pct}% pass rate`}
        />
      </div>
      <div className="mt-1.5 flex items-center justify-between text-xs">
        <span className="font-medium text-gray-900">{pct}% pass</span>
        <span className="text-gray-500">
          {w.passed}P / {w.failed}F
        </span>
      </div>
    </div>
  );
}

// ---- FlakyCasesCard (dashboard widget) -----------------------------------
//
// Two distinct reliability problems get different sections:
//
//   1. Flaky tests  — alternation patterns (PFPF…). Recover between
//                     runs. Investigate by re-running.
//
//   2. Recent regressions — was passing, now consistently failing.
//                           Won't fix itself; code/config changed.
//
// We split the response client-side so both classes get the same
// `flaky` endpoint call, but render into two visually distinct lists
// with their own counts. `data-cy="flaky-cases-card"` stays on the
// outer wrapper so the existing dashboard test continues to work;
// new `data-cy="regressions-section"` / `"flaky-section"` markers
// expose the split.

interface FlakyCasesCardProps {
  threshold?: number;
}

function FlakyRow({ c }: { c: NonNullable<ReturnType<typeof useFlakyList>['data']>['cases'][number] }) {
  const palette = verdictPalette(c.verdict);
  return (
    <li
      data-cy="flaky-case-row"
      data-case-id={c.case_id}
      data-verdict={c.verdict}
      className="py-2"
    >
      <div className="flex items-center justify-between gap-3">
        <Link
          to={`/cases/${c.case_id}`}
          data-cy="flaky-case-link"
          className="min-w-0 truncate text-sm text-gray-900 hover:text-blue-600 hover:underline"
        >
          {c.title}
        </Link>
        <span
          className={`inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium ${palette.bg} ${palette.text} ${palette.border}`}
          title={`${c.sample_size} runs scored`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${palette.dot}`} />
          {c.score == null ? '—' : Math.round(c.score)}
        </span>
      </div>
    </li>
  );
}

export function FlakyCasesCard({ threshold = 50 }: FlakyCasesCardProps) {
  const q = useFlakyList(threshold);
  const data = q.data;
  const cases = data?.cases ?? [];
  const hasData = !q.isLoading && !!data;

  // Split by verdict — broken is a regression, the rest are flakes.
  const regressions = cases.filter((c) => c.verdict === 'broken');
  const flaky = cases.filter((c) => c.verdict !== 'broken');

  return (
    <section
      data-cy="flaky-cases-card"
      data-threshold={threshold}
      className="rounded border border-gray-200 bg-white p-4"
    >
      <div className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-orange-500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 017.753-1.977A4.5 4.5 0 0113.5 16h-8z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900">Test reliability</h3>
          {/* Combined count — kept under the old data-cy so the existing
              dashboard test still passes. */}
          <span
            data-cy="flaky-cases-count"
            className="rounded-full bg-orange-100 px-2 py-0.5 text-xs font-semibold text-orange-800"
          >
            {hasData ? data!.count : '–'}
          </span>
        </div>
        {/* "View all" intentionally lands on the unfiltered list — each
            sub-section below has its own targeted "View all" link. */}
      </div>

      {q.isLoading && (
        <div className="px-2 py-4 text-center text-xs text-gray-500">Scoring…</div>
      )}

      {q.error && (
        <div className="px-2 py-4 text-center text-xs text-red-700">
          Could not score cases.
        </div>
      )}

      {hasData && cases.length === 0 && (
        <div className="px-2 py-4 text-center text-xs text-gray-500">
          All tests are reliable above score {threshold}. 🎉
        </div>
      )}

      {hasData && regressions.length > 0 && (
        <div data-cy="regressions-section" className="mb-3 rounded border border-rose-200 bg-rose-50/50 p-2">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-rose-600" viewBox="0 0 20 20" fill="currentColor">
                <path d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.168 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 6a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 6zm0 9a1 1 0 100-2 1 1 0 000 2z" />
              </svg>
              <h4 className="text-xs font-semibold text-rose-900">Recent regressions</h4>
              <span
                data-cy="regressions-count"
                className="rounded-full bg-rose-100 px-1.5 py-0.5 text-[10px] font-semibold text-rose-800"
              >
                {regressions.length}
              </span>
            </div>
            <Link
              to={`/cases?verdict=broken`}
              data-cy="regressions-view-all"
              className="text-[10px] font-medium text-rose-700 hover:underline"
              title="Was passing, now consistently failing — code/config likely changed"
            >
              View all →
            </Link>
          </div>
          <ul data-cy="regressions-list" className="divide-y divide-rose-100">
            {regressions.slice(0, 5).map((c) => (
              <FlakyRow key={c.case_id} c={c} />
            ))}
          </ul>
        </div>
      )}

      {hasData && flaky.length > 0 && (
        <div data-cy="flaky-section">
          <div className="mb-1 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <svg className="h-3.5 w-3.5 text-orange-500" viewBox="0 0 20 20" fill="currentColor">
                <path d="M5.5 16a3.5 3.5 0 01-.369-6.98 4 4 0 017.753-1.977A4.5 4.5 0 0113.5 16h-8z" />
              </svg>
              <h4 className="text-xs font-semibold text-gray-700">Flaky tests</h4>
              <span
                data-cy="flaky-section-count"
                className="rounded-full bg-orange-100 px-1.5 py-0.5 text-[10px] font-semibold text-orange-800"
              >
                {flaky.length}
              </span>
            </div>
            <Link
              to={`/cases?verdict=flaky`}
              data-cy="flaky-section-view-all"
              className="text-[10px] font-medium text-orange-700 hover:underline"
              title="Alternation patterns — investigate by re-running"
            >
              View all →
            </Link>
          </div>
          <ul data-cy="flaky-section-list" className="divide-y divide-gray-100">
            {flaky.slice(0, 5).map((c) => (
              <FlakyRow key={c.case_id} c={c} />
            ))}
          </ul>
        </div>
      )}

      {hasData && cases.length > 0 && flaky.length === 0 && regressions.length === 0 && (
        // unreachable: covered by the empty state above, kept for safety
        <div className="px-2 py-4 text-center text-xs text-gray-500">
          Nothing above score {threshold}.
        </div>
      )}
    </section>
  );
}

// ---- utilities -----------------------------------------------------------

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
