// RunPanel — UI companion to FlakinessPanel.
//
// Mounted full-width above the case-detail body so it sits directly
// under the header. Behaviour:
//
//   - Visitors with admin/editor role see a "Run" button + a snippet
//     textarea (read-only when a run is in flight, editable otherwise).
//   - Viewers see the snippet read-only + a note explaining who can run.
//   - During a run the panel subscribes to the SSE feed and renders a
//     streaming log tail.
//   - On terminal status (passed/failed/errored) it renders a result
//     summary with the assertion count, duration, exit code, and any
//     captured error log.
//
// This component owns its own SSE subscription rather than handing an
// `onEvent` callback up to the page; the panel's lifecycle is the same
// as the run's lifecycle, so co-locating them is simpler.
//
// Tier4-PR-R. Pulled onto the design system:
//   - outer <aside> uses rg-card border/bg/shadow.
//   - inline SVG play / spinner icons → Icon.Run / Spinner.
//   - raw <button> styling → <Button variant="brand|secondary">.
//   - raw <textarea> with focus:border-blue-500 → rg-input.
//   - paletteFor() helper + raw colour ramps → Pill tones
//     (info / result-passed / result-failed / danger).
//   - raw result box (border-emerald-200 / bg-emerald-50 / etc.) →
//     Card tone="flush" wrapper + theme utility text.
// All data-cy hooks preserved verbatim.

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { Button, Spinner } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icons';
import { Pill, type PillTone } from '@/components/Pill';
import { useAuth } from '@/hooks/useAuth';
import { http } from '@/lib/http';
import { showToast } from '@/lib/toast';

import { useExecuteCase, useRunStream } from '../runs/hooks';
import type { CaseData } from './api';

interface RunPanelProps {
  caseData: CaseData;
}

type UiStatus = 'idle' | 'running' | 'passed' | 'failed' | 'errored';

const MAX_LOG_LINES = 80;
const MAX_LOG_CHARS = 4 * 1024;

const STATUS_TONE: Record<UiStatus, PillTone> = {
  idle: 'neutral',
  running: 'info',
  passed: 'result-passed',
  failed: 'result-failed',
  errored: 'danger',
};

const RESULT_TONE: Record<'passed' | 'failed' | 'errored', PillTone> = {
  passed: 'result-passed',
  failed: 'result-failed',
  errored: 'danger',
};

// Visual wrapper around Pill so the running badge can animate. When
// status === 'running' we suppress Pill's static ::before dot via a
// Tailwind arbitrary selector and render a single pulsing dot ourselves,
// keeping the visual exactly what it was before this refactor.
function StatusBadge({ status }: { status: UiStatus }) {
  const isRunning = status === 'running';
  return (
    <span
      data-cy="run-status"
      data-status={status}
      className="inline-flex items-center gap-1.5"
    >
      <Pill
        tone={STATUS_TONE[status]}
        className={isRunning ? '[&::before]:hidden' : ''}
      >
        {statusLabel(status)}
      </Pill>
      {isRunning && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 rounded-full bg-info animate-pulse"
        />
      )}
    </span>
  );
}

export function RunPanel({ caseData }: RunPanelProps) {
  const { user } = useAuth();
  const canExecute = user?.role === 'admin' || user?.role === 'editor';

  const [activeRunId, setActiveRunId] = useState<number | null>(null);
  const [status, setStatus] = useState<UiStatus>('idle');
  const [logTail, setLogTail] = useState<string>('');
  const [snippet, setSnippet] = useState<string>(caseData.executable_snippet ?? '');
  const [result, setResult] = useState<{
    status: 'passed' | 'failed' | 'errored';
    assertionCount: number | null;
    exitCode: number | null;
    errorLog?: string;
  } | null>(null);
  const [savingSnippet, setSavingSnippet] = useState(false);

  const executeM = useExecuteCase();
  const qc = useQueryClient();
  const snippetRef = useRef(snippet);
  snippetRef.current = snippet;

  // When the underlying case's snippet changes (e.g. after the user
  // saves a new one through CaseForm), sync local state so the panel
  // doesn't render stale content.
  useEffect(() => {
    if (status === 'idle' && !activeRunId) {
      setSnippet(caseData.executable_snippet ?? '');
    }
  }, [caseData.executable_snippet, status, activeRunId]);

  // Stable handler — re-subscribing to SSE on every render would drop
  // the in-flight events.
  const handleStreamEvent = useCallback((event: string, data: unknown) => {
    if (event === 'done') {
      const payload = data as {
        status: 'passed' | 'failed' | 'errored';
        assertionCount?: number | null;
        exitCode?: number | null;
        errorLog?: string;
      };
      setStatus(payload.status);
      setResult({
        status: payload.status,
        assertionCount: payload.assertionCount ?? null,
        exitCode: payload.exitCode ?? null,
        errorLog: payload.errorLog,
      });
      setActiveRunId(null);

      // Sync the case caches. The executor's finalize path already
      // wrote the terminal result to the DB (TestCase.result + last_run_at),
      // so we mirror that here so the pill on the detail header and the
      // pill on the /cases list both flip without a manual refresh.
      // 'errored' runs do NOT update result on the case (Cypress crashed
      // mid-flight, not an assertion verdict), so we skip those.
      if (payload.status === 'passed' || payload.status === 'failed') {
        const finishedAt = new Date().toISOString();
        qc.setQueryData<CaseData>(['cases', caseData.id], (old) => {
          if (!old) return old;
          return {
            ...old,
            result: payload.status,
            last_run_at: finishedAt,
          };
        });
        // Invalidate the list so the pill flips when the user navigates
        // back to /cases. We patch optimistically above for this page;
        // the invalidation here just guarantees consistency across views.
        qc.invalidateQueries({ queryKey: ['cases'] });
        // Flakiness score derives from the runs table — kick it too.
        qc.invalidateQueries({ queryKey: ['cases', caseData.id, 'flakiness'] });
        qc.invalidateQueries({ queryKey: ['flaky-cases'] });
        qc.invalidateQueries({ queryKey: ['runs', 'recent'] });
      }
      return;
    }
    if (event === 'snapshot' || event === 'progress') {
      // Snapshot: { status: 'running' | ... } or Progress: { phase }
      const payload = data as { status?: UiStatus; phase?: string };
      if (payload?.status && isUiStatus(payload.status)) {
        setStatus(payload.status);
        if (payload.status !== 'running') {
          setActiveRunId(null);
        }
      }
      return;
    }
    if (event === 'stdout' || event === 'stderr') {
      const chunk = typeof data === 'string' ? data : '';
      if (!chunk) return;
      setLogTail((prev) => {
        const next = prev + chunk;
        // Trim to keep the DOM small.
        const trimmed = next.length > MAX_LOG_CHARS
          ? next.slice(-MAX_LOG_CHARS)
          : next;
        return trimmed;
      });
      return;
    }
    if (event === 'error') {
      // Connection-level error — bail to a useful terminal state.
      setStatus('errored');
      setResult((r) => r ?? {
        status: 'errored',
        assertionCount: null,
        exitCode: null,
        errorLog: typeof data === 'object' && data && 'message' in (data as Record<string, unknown>)
          ? String((data as { message?: unknown }).message)
          : undefined,
      });
      setActiveRunId(null);
    }
  }, [qc, caseData.id]);
  useRunStream(activeRunId, handleStreamEvent);

  function startRun() {
    if (!canExecute) return;
    if (status === 'running') return;
    // Pull the latest snippet value from the ref so we don't fire with a
    // stale closure.
    const snippetToRun = snippetRef.current.trim();
    if (!snippetToRun) {
      showToast({ message: 'Add a Cypress snippet before running.', variant: 'warning' });
      return;
    }
    setStatus('running');
    setLogTail('');
    setResult(null);
    executeM.mutate(caseData.id, {
      onSuccess: (run) => setActiveRunId(run.id),
      onError: (err) => {
        setStatus('errored');
        const msg = (err as { response?: { data?: { error?: string } } })
          ?.response?.data?.error ?? 'Failed to start run';
        showToast({ message: msg, variant: 'error' });
      },
    });
  }

  async function saveSnippet() {
    if (!canExecute) return;
    setSavingSnippet(true);
    try {
      // Use the shared axios instance so the Bearer header, baseURL,
      // and 401-redirect interceptor all apply here too. Previously
      // this used raw fetch() with a manually-attached token, which
      // bypassed the http client's token refresh / error normalization.
      await http.put(`/test-cases/${caseData.id}`, {
        executable_snippet: snippet.trim() || null,
      });
      showToast({ message: 'Snippet saved.', variant: 'success' });
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Save failed', variant: 'error' });
    } finally {
      setSavingSnippet(false);
    }
  }

  return (
    <Card
      data-cy="run-panel"
      tone="default"
      className="overflow-hidden"
    >
      <header className="flex items-center justify-between border-b border-border-soft px-5 py-3">
        <div className="flex items-center gap-2">
          <Icon.Run size={14} className="text-text-tertiary" />
          <h3 className="text-sm font-semibold text-text">Test execution</h3>
        </div>
        <StatusBadge status={status} />
      </header>

      <div className="space-y-4 px-5 py-4">
        <div>
          <label
            htmlFor="run-snippet-input"
            className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-text-tertiary"
          >
            Cypress snippet
          </label>
          <textarea
            id="run-snippet-input"
            data-cy="run-snippet-input"
            value={snippet}
            onChange={(e) => setSnippet(e.target.value)}
            disabled={!canExecute || status === 'running'}
            rows={6}
            placeholder="it('logs in', () => { cy.visit('/login'); ... })"
            className="rg-input font-mono text-xs disabled:cursor-not-allowed disabled:bg-surface-sunken disabled:text-text-tertiary"
          />
          <p className="mt-1 text-[11px] text-text-tertiary">
            Paste a Cypress test body. It runs against the local app server at{' '}
            <code className="rounded bg-surface-sunken px-1 py-0.5 text-[10px]">/</code>{' '}
            via the bundled Electron browser.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="brand"
            size="md"
            data-cy="run-btn"
            data-writable="true"
            leftIcon={status === 'running' ? <Spinner size={14} /> : <Icon.Run size={14} />}
            onClick={startRun}
            disabled={!canExecute || status === 'running' || !snippet.trim()}
          >
            {status === 'running' ? 'Running…' : 'Run'}
          </Button>
          {canExecute && snippet !== (caseData.executable_snippet ?? '') && (
            <Button
              type="button"
              variant="secondary"
              size="md"
              data-cy="run-snippet-save"
              onClick={saveSnippet}
              disabled={savingSnippet || status === 'running'}
              loading={savingSnippet}
            >
              Save snippet
            </Button>
          )}
          {!canExecute && (
            <span className="text-[11px] italic text-text-tertiary">
              Viewers cannot run tests. Ask an admin or editor to execute this case.
            </span>
          )}
        </div>

        {status === 'running' && (
          <div
            data-cy="run-progress"
            className="space-y-1 rounded border border-info-border bg-info-soft p-3"
          >
            <div className="flex items-center gap-2 text-xs font-medium text-info-text">
              <Spinner size={14} />
              Running on the server…
            </div>
            {logTail && (
              <pre
                data-cy="run-log"
                className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-bg-elevated/70 p-2 font-mono text-[11px] leading-snug text-text-secondary"
              >
                {truncate(logTail)}
              </pre>
            )}
          </div>
        )}

        {result && (
          <div
            data-cy="run-result"
            className={`rounded border p-3 ${
              result.status === 'passed'
                ? 'border-result-passed-soft bg-result-passed-soft/40 text-success-text'
                : result.status === 'failed'
                  ? 'border-result-failed-soft bg-result-failed-soft/40 text-danger-text'
                  : 'border-danger-border bg-danger-soft/40 text-danger-text'
            }`}
          >
            <div className="flex items-center justify-between text-sm font-medium">
              <span data-cy="run-result-status">
                <Pill tone={RESULT_TONE[result.status]}>{resultLabel(result.status)}</Pill>
              </span>
              <span className="font-mono text-xs">
                exit {result.exitCode ?? '?'}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <Stat label="Assertions" value={result.assertionCount ?? '—'} />
            </dl>
            {result.errorLog && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-danger-text">Error log</summary>
                <pre
                  data-cy="run-result-error"
                  className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-bg-elevated/80 p-2 font-mono text-[11px] text-danger-text"
                >
                  {result.errorLog}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}

// Display helpers ---------------------------------------------------------

function isUiStatus(v: unknown): v is UiStatus {
  return v === 'idle' || v === 'running' || v === 'passed' || v === 'failed' || v === 'errored';
}

function statusLabel(s: UiStatus): string {
  switch (s) {
    case 'idle': return 'Idle';
    case 'running': return 'Running';
    case 'passed': return 'Passed';
    case 'failed': return 'Failed';
    case 'errored': return 'Errored';
  }
}

function resultLabel(s: 'passed' | 'failed' | 'errored'): string {
  switch (s) {
    case 'passed': return '✓ Passed';
    case 'failed': return '✕ Failed';
    case 'errored': return '⚠ Errored';
  }
}

function truncate(s: string): string {
  // Show at most MAX_LOG_LINES so a chatty Cypress doesn't bury the UI.
  const lines = s.split('\n');
  if (lines.length <= MAX_LOG_LINES) return s;
  return lines.slice(-MAX_LOG_LINES).join('\n');
}

function Stat({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="text-[10px] font-semibold uppercase tracking-wider opacity-70">{label}</dt>
      <dd className="font-mono text-xs">{value ?? '—'}</dd>
    </div>
  );
}
