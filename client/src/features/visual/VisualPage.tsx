// =============================================================================
// /admin/visual — visual regression page (Feature 3).
//
// Lists runs that carry a pixel diff (diff_score stored on the TestRun row)
// and lets the admin inspect baseline / current / diff side by side.
//
// data-cy contract:
//   visual-empty / visual-table / visual-row / visual-score / visual-verdict
//   visual-run-select / visual-images / visual-image-before / visual-image-after
//   visual-image-diff / visual-run-title
// =============================================================================

import { useState } from 'react';

import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';

import type { VisualRun } from './api';
import { useVisualRuns } from './hooks';

const verdictClass = (v: string | null) => {
  if (v === 'identical') return 'result-passed';
  if (v === 'minor') return 'result-not_run';
  return 'result-failed';
};

export function VisualPage() {
  const q = useVisualRuns();
  const runs = q.data ?? [];
  const [selected, setSelected] = useState<VisualRun | null>(null);
  const active = selected ?? runs[0] ?? null;

  const scorePct = active?.diff_score != null ? Math.round(active.diff_score * 100) : null;

  const state = q.isLoading ? 'loading' : q.error ? 'error' : runs.length === 0 ? 'empty' : 'ready';

  return (
    <div
      className="space-y-6"
      data-cy="visual-root"
      data-state={state}
    >
      <PageHeader
        eyebrow="Quality Signals"
        title="Visual regression"
        description="Every run that captured screenshots and produced a pixel diff. Low scores mean the UI barely moved; high scores flag a design that changed."
      />

      {q.error && (
        <div className="flex items-start gap-3 rounded-lg border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <Icon.Warning size={16} />
          <div>
            <strong className="font-semibold">Failed to load</strong>
            <p className="mt-0.5 text-xs opacity-90">{(q.error as Error).message}</p>
          </div>
        </div>
      )}

      {runs.length === 0 && !q.isLoading && (
        <Card data-cy="visual-empty">
          <EmptyState
            icon={<Icon.Cases size={20} />}
            title="No visual diffs yet"
            description="Runs that take two or more cy.screenshot() calls produce a diff here."
          />
        </Card>
      )}

      {runs.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-cy="visual-table">
              <thead className="bg-surface-sunken text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Run</th>
                  <th className="px-5 py-2.5 font-medium">Case</th>
                  <th className="px-5 py-2.5 font-medium">Score</th>
                  <th className="px-5 py-2.5 font-medium">Verdict</th>
                  <th className="px-5 py-2.5 text-right font-medium">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {runs.map((r) => (
                  <tr
                    key={r.run_id}
                    data-cy="visual-row"
                    data-run-id={r.run_id}
                    className={`transition-colors hover:bg-surface-hover ${active?.run_id === r.run_id ? 'bg-surface-hover' : ''}`}
                  >
                    <td className="px-5 py-3 text-xs text-text-secondary whitespace-nowrap">
                      #{r.run_id}
                    </td>
                    <td className="px-5 py-3 font-medium text-text">
                      {r.case_title ?? `case #${r.case_id}`}
                    </td>
                    <td data-cy="visual-score" className="px-5 py-3 font-semibold text-text">
                      {r.diff_score != null ? `${Math.round(r.diff_score * 100)}%` : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <span data-cy="visual-verdict" className={`rg-pill rg-pill-${verdictClass(r.verdict)}`}>
                        {r.verdict ?? 'n/a'}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button
                        type="button"
                        data-cy="visual-run-select"
                        className="btn small"
                        onClick={() => setSelected(r)}
                      >
                        View diff
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {active && (
        <Card className="p-4" data-cy="visual-images">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 data-cy="visual-run-title" className="text-sm font-semibold text-text">
                Run #{active.run_id} — {active.case_title ?? `case #${active.case_id}`}
              </h3>
              <p className="mt-0.5 text-xs text-text-secondary">
                Diff score {scorePct}% · {active.verdict}
                {active.finished_at ? ` · ${new Date(active.finished_at).toLocaleString()}` : ''}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div>
              <div className="mb-1 text-xs font-medium text-text-secondary">Before (baseline)</div>
              {active.urls.before ? (
                <img
                  data-cy="visual-image-before"
                  src={active.urls.before}
                  alt="baseline screenshot"
                  className="w-full rounded-lg border border-border-soft bg-surface-sunken"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border-soft text-xs text-text-tertiary">
                  no baseline
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-text-secondary">After (current)</div>
              {active.urls.after ? (
                <img
                  data-cy="visual-image-after"
                  src={active.urls.after}
                  alt="current screenshot"
                  className="w-full rounded-lg border border-border-soft bg-surface-sunken"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border-soft text-xs text-text-tertiary">
                  no current
                </div>
              )}
            </div>
            <div>
              <div className="mb-1 text-xs font-medium text-text-secondary">Diff</div>
              {active.urls.diff ? (
                <img
                  data-cy="visual-image-diff"
                  src={active.urls.diff}
                  alt="pixel diff"
                  className="w-full rounded-lg border border-border-soft bg-surface-sunken"
                />
              ) : (
                <div className="flex h-40 items-center justify-center rounded-lg border border-dashed border-border-soft text-xs text-text-tertiary">
                  no diff image
                </div>
              )}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}