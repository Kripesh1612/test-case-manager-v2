// runs/api.ts — Phase 8 client for the test-execution endpoints.
//
// Two responsibilities:
//
//   executeCase(caseId)
//     Returns the freshly-created TestRun row from POST
//     /test-cases/:id/execute. The row's status will be 'running' on
//     return — the actual run finishes asynchronously.
//
//   subscribeRunStream(runId, onEvent) → unsubscribe
//     Opens a long-lived fetch() request against /runs/:id/stream and
//     dispatches each SSE frame to the caller. EventSource doesn't
//     accept custom request headers, so we hand-roll it via ReadableStream.

import { http } from '@/lib/http';
import { TOKEN_KEY } from '@/lib/http';

export interface ExecuteRunResponse {
  id: number;
  test_case_id: number;
  status: 'running' | 'passed' | 'failed' | 'errored' | 'not_run';
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  notes: string | null;
  run_by_id: number | null;
  // Set if the row already has executor-derived fields.
  error_log?: string | null;
  assertion_count?: number | null;
  exit_code?: number | null;
  started_via?: string | null;
}

export async function executeCase(caseId: number): Promise<ExecuteRunResponse> {
  const { data } = await http.post<ExecuteRunResponse>(
    `/test-cases/${caseId}/execute`,
  );
  return data;
}

// Opens a GET /runs/:id/stream over SSE. The returned function aborts the
// connection when called. Multiple subscribers to the same runId are
// supported — each call gets its own independent fetch.
export function subscribeRunStream(
  runId: number,
  onEvent: (event: string, data: unknown) => void,
): () => void {
  const controller = new AbortController();
  const token = typeof localStorage !== 'undefined'
    ? localStorage.getItem(TOKEN_KEY)
    : null;

  // Begin the fetch in the background. Errors are surfaced as 'error'
  // SSE events so the caller's UI can render a useful terminal state.
  (async () => {
    try {
      const response = await fetch(`/runs/${runId}/stream`, {
        method: 'GET',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
        // Don't auto-redirect — the SSE endpoint returns the raw stream,
        // not a JSON body a redirect would lose data on.
        redirect: 'manual',
      });

      if (!response.ok || !response.body) {
        onEvent('error', { status: response.status });
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      // SSE frames are separated by "\n\n". Each frame has lines like
      //   event: <name>
      //   data: <json>
      // followed by an empty line. We accumulate into `buffer` until we
      // see a frame terminator.
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let frameEnd;
        // eslint-disable-next-line no-cond-assign
        while ((frameEnd = buffer.indexOf('\n\n')) !== -1) {
          const rawFrame = buffer.slice(0, frameEnd);
          buffer = buffer.slice(frameEnd + 2);
          const parsed = parseFrame(rawFrame);
          if (parsed) {
            onEvent(parsed.event, parsed.data);
            if (parsed.event === 'done' || parsed.event === 'error') {
              try { controller.abort(); } catch (_) {}
              return;
            }
          }
        }
      }

      // Stream closed without a 'done' event — usually means the server
      // went away. Surface so the UI can render a useful terminal state.
      if (buffer) {
        const parsed = parseFrame(buffer);
        if (parsed) onEvent(parsed.event, parsed.data);
      }
    } catch (err) {
      if ((err as { name?: string })?.name === 'AbortError') return;
      onEvent('error', { message: String((err as Error)?.message || err) });
    }
  })();

  return () => {
    try { controller.abort(); } catch (_) {}
  };
}

function parseFrame(raw: string): { event: string; data: unknown } | null {
  let event = 'message';
  let dataStr = '';
  // Some SSE implementations add comments ("\r") and trailing whitespace;
  // we just look at the meaningful lines.
  for (const line of raw.split('\n')) {
    if (!line) continue;
    if (line.startsWith(':')) continue; // SSE comment
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const field = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (field === 'event') event = value;
    else if (field === 'data') dataStr = value;
  }
  if (!dataStr && event === 'message') return null;
  let parsed: unknown = dataStr;
  try { parsed = JSON.parse(dataStr); } catch (_) { /* keep as string */ }
  return { event, data: parsed };
}
