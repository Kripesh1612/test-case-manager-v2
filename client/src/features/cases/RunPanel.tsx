// RunPanel — Phase 8 UI companion to FlakinessPanel.
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

import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import { useExecuteCase, useRunStream } from '../runs/hooks';
import type { CaseData } from './api';

interface RunPanelProps {
  caseData: CaseData;
}

type UiStatus = 'idle' | 'running' | 'passed' | 'failed' | 'errored';

const MAX_LOG_LINES = 80;
const MAX_LOG_CHARS = 4 * 1024;

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
      const res = await fetch(`/test-cases/${caseData.id}`, {
        method: 'PUT',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('tcm_token') ?? ''}`,
        },
        body: JSON.stringify({ executable_snippet: snippet.trim() || null }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Save failed (${res.status})`);
      }
      showToast({ message: 'Snippet saved.', variant: 'success' });
    } catch (e) {
      showToast({ message: e instanceof Error ? e.message : 'Save failed', variant: 'error' });
    } finally {
      setSavingSnippet(false);
    }
  }

  const palette = paletteFor(status);

  return (
    <aside data-cy="run-panel" className="rounded-lg border border-gray-200 bg-white shadow-sm">
      <header className="flex items-center justify-between border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <svg className="h-4 w-4 text-gray-500" viewBox="0 0 20 20" fill="currentColor">
            <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
          </svg>
          <h3 className="text-sm font-semibold text-gray-900">Test execution</h3>
        </div>
        <span
          data-cy="run-status"
          data-status={status}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium ${palette.bg} ${palette.text} ${palette.border}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${palette.dot} ${status === 'running' ? 'animate-pulse' : ''}`} />
          {statusLabel(status)}
        </span>
      </header>

      <div className="space-y-4 px-5 py-4">
        <div>
          <label className="mb-1 block text-[11px] font-semibold uppercase tracking-wider text-gray-500">
            Cypress snippet
          </label>
          <textarea
            data-cy="run-snippet-input"
            value={snippet}
            onChange={(e) => setSnippet(e.target.value)}
            disabled={!canExecute || status === 'running'}
            rows={6}
            placeholder="it('logs in', () => { cy.visit('/login'); ... })"
            className="w-full rounded border border-gray-300 bg-white px-2.5 py-1.5 font-mono text-xs text-gray-800 focus:border-blue-500 focus:outline-none disabled:cursor-not-allowed disabled:bg-gray-50 disabled:text-gray-500"
          />
          <p className="mt-1 text-[11px] text-gray-500">
            Paste a Cypress test body. It runs against the local app server at <code className="rounded bg-gray-100 px-1 py-0.5 text-[10px]">/</code> via the bundled Electron browser.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            data-cy="run-btn"
            data-writable="true"
            onClick={startRun}
            disabled={!canExecute || status === 'running' || !snippet.trim()}
            className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            <svg className="h-3.5 w-3.5" viewBox="0 0 20 20" fill="currentColor">
              <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
            </svg>
            {status === 'running' ? 'Running…' : 'Run'}
          </button>
          {canExecute && snippet !== (caseData.executable_snippet ?? '') && (
            <button
              type="button"
              data-cy="run-snippet-save"
              onClick={saveSnippet}
              disabled={savingSnippet || status === 'running'}
              className="inline-flex items-center rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {savingSnippet ? 'Saving…' : 'Save snippet'}
            </button>
          )}
          {!canExecute && (
            <span className="text-[11px] italic text-gray-500">
              Viewers cannot run tests. Ask an admin or editor to execute this case.
            </span>
          )}
        </div>

        {status === 'running' && (
          <div data-cy="run-progress" className="space-y-1 rounded border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-blue-800">
              <svg className="h-3.5 w-3.5 animate-spin text-blue-500" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Running on the server…
            </div>
            {logTail && (
              <pre data-cy="run-log" className="max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/70 p-2 font-mono text-[11px] leading-snug text-gray-700">
                {truncate(logTail)}
              </pre>
            )}
          </div>
        )}

        {result && (
          <div data-cy="run-result" className={`rounded border p-3 ${resultPalette(result.status)}`}>
            <div className="flex items-center justify-between text-sm font-medium">
              <span data-cy="run-result-status">{resultLabel(result.status)}</span>
              <span className="font-mono text-xs">
                exit {result.exitCode ?? '?'}
              </span>
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-2 text-xs">
              <Stat label="Assertions" value={result.assertionCount ?? '—'} />
            </dl>
            {result.errorLog && (
              <details className="mt-2">
                <summary className="cursor-pointer text-xs font-medium text-rose-900">Error log</summary>
                <pre data-cy="run-result-error" className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded bg-white/80 p-2 font-mono text-[11px] text-rose-900">
                  {result.errorLog}
                </pre>
              </details>
            )}
          </div>
        )}
      </div>
    </aside>
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

function paletteFor(s: UiStatus) {
  switch (s) {
    case 'idle':
      return { bg: 'bg-gray-50', text: 'text-gray-700', border: 'border-gray-200', dot: 'bg-gray-400' };
    case 'running':
      return { bg: 'bg-blue-50', text: 'text-blue-800', border: 'border-blue-200', dot: 'bg-blue-500' };
    case 'passed':
      return { bg: 'bg-emerald-50', text: 'text-emerald-800', border: 'border-emerald-200', dot: 'bg-emerald-500' };
    case 'failed':
      return { bg: 'bg-red-50', text: 'text-red-800', border: 'border-red-200', dot: 'bg-red-500' };
    case 'errored':
      return { bg: 'bg-rose-50', text: 'text-rose-900', border: 'border-rose-300', dot: 'bg-rose-600' };
  }
}

function resultPalette(s: 'passed' | 'failed' | 'errored') {
  switch (s) {
    case 'passed': return 'border-emerald-200 bg-emerald-50 text-emerald-900';
    case 'failed': return 'border-red-200 bg-red-50 text-red-900';
    case 'errored': return 'border-rose-300 bg-rose-50 text-rose-900';
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
