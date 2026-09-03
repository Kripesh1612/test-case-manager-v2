// runs/hooks.ts — React hooks for test execution.
//
//   useExecuteCase() — TanStack mutation wrapping `executeCase()`.
//      On success invalidates the runs + flakiness queries so the rest
//      of the UI (case detail's history, dashboard's recent feed)
//      refetches the moment the executor reports completion.
//
//   useRunStream(runId, onEvent) — opens an SSE subscription scoped to
//      the supplied runId and tears it down on unmount or when runId
//      changes. The caller owns the `onEvent` callback (which is
//      typically wrapped in useCallback by the consuming component).

import { useEffect } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { executeCase, subscribeRunStream } from './api';

export function useExecuteCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: number) => executeCase(caseId),
    onSuccess: (run) => {
      // Invalidate anything that depends on the run history for this
      // case so the runs list refetches as soon as the executor
      // finishes. The flakiness score also consumes the runs table,
      // so we kick that too.
      qc.invalidateQueries({ queryKey: ['cases', run.test_case_id, 'runs'] });
      qc.invalidateQueries({ queryKey: ['runs', 'recent'] });
      qc.invalidateQueries({ queryKey: ['cases', run.test_case_id, 'flakiness'] });
    },
  });
}

export function useRunStream(
  runId: number | null,
  onEvent: (event: string, data: unknown) => void,
) {
  useEffect(() => {
    if (runId == null) return undefined;
    const unsub = subscribeRunStream(runId, onEvent);
    return unsub;
    // onEvent's identity is allowed to vary — callers typically wrap it
    // in a stable useCallback. We deliberately exclude it from deps so a
    // referentially-unstable callback doesn't re-subscribe every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);
}
