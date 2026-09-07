// TanStack Query hooks for the /test-cases resource.
//
// `useCreateCase` / `useUpdateCase` / `useDeleteCase` patch the cache
// in `onSuccess` so the list re-renders immediately without a refetch.
// `useCases` is the single source of truth for the list page.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  type CaseCreateInput,
  type CaseData,
  type CaseUpdateInput,
  createCase,
  deleteCase,
  fetchCase,
  fetchCases,
  fetchDiff,
  fetchFlakiness,
  fetchFlakyList,
  fetchVersion,
  fetchVersions,
  restoreVersion,
  updateCase,
} from './api';

const CASES_KEY = ['cases'] as const;
const caseKey = (caseId: number) => ['cases', caseId] as const;
const versionsKey = (caseId: number) => ['cases', caseId, 'versions'] as const;
const versionKey = (caseId: number, versionId: number) =>
  ['cases', caseId, 'versions', versionId] as const;
const diffKey = (caseId: number, fromId: number, toId: number) =>
  ['cases', caseId, 'diff', fromId, toId] as const;

export function useCases() {
  return useQuery({
    queryKey: CASES_KEY,
    queryFn: fetchCases,
    staleTime: 30_000,
  });
}

export function useCase(caseId: number) {
  return useQuery({
    queryKey: caseKey(caseId),
    queryFn: () => fetchCase(caseId),
    staleTime: 30_000,
    enabled: Number.isFinite(caseId),
  });
}

export function useCreateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CaseCreateInput) => createCase(input),
    onSuccess: (created) => {
      qc.setQueryData<CaseData[]>(CASES_KEY, (old) => (old ? [...old, created] : [created]));
    },
  });
}

export function useUpdateCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: CaseUpdateInput }) => updateCase(id, input),
    onSuccess: (updated) => {
      qc.setQueryData<CaseData[]>(CASES_KEY, (old) =>
        old ? old.map((c) => (c.id === updated.id ? updated : c)) : [updated],
      );
      // Also patch the single-case cache so the detail page updates
      // immediately after a mutation (e.g. inline edit, mark as pass).
      qc.setQueryData<CaseData>(caseKey(updated.id), updated);
    },
  });
}

export function useDeleteCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteCase(id),
    // mutateAsync's resolved value is void (204 No Content), but the
    // `id` we passed as variables is the second onSuccess arg.
    onSuccess: (_void, id) => {
      qc.setQueryData<CaseData[]>(CASES_KEY, (old) => (old ? old.filter((c) => c.id !== id) : []));
    },
  });
}

// ---- Versioning hooks ----
//
// Versions are scoped per case; the query keys include the case id so
// navigating between cases doesn't show stale data. Stale time is short
// (5s) so re-opening a case shows the latest snapshot.

export function useVersions(caseId: number) {
  return useQuery({
    queryKey: versionsKey(caseId),
    queryFn: () => fetchVersions(caseId),
    staleTime: 5_000,
    enabled: Number.isFinite(caseId),
  });
}

export function useVersion(caseId: number, versionId: number) {
  return useQuery({
    queryKey: versionKey(caseId, versionId),
    queryFn: () => fetchVersion(caseId, versionId),
    staleTime: 60_000, // snapshots are immutable — cache aggressively
    enabled: Number.isFinite(caseId) && Number.isFinite(versionId),
  });
}

export function useCaseDiff(caseId: number, fromId: number, toId: number) {
  return useQuery({
    queryKey: diffKey(caseId, fromId, toId),
    queryFn: () => fetchDiff(caseId, fromId, toId),
    // Diff results are deterministic per (case, from, to) triple, so
    // we can cache aggressively too.
    staleTime: 60_000,
    enabled: Number.isFinite(caseId) && Number.isFinite(fromId) && Number.isFinite(toId) && fromId !== toId,
  });
}

export function useRestoreVersion(caseId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (versionId: number) => restoreVersion(caseId, versionId),
    // After restore, the live case is updated AND a new version is
    // appended. Invalidate the list + versions so both refetch on next
    // mount; the live row's cache entry isn't optimistically patched
    // because the new version row carries the post-restore state.
    onSuccess: (updated) => {
      qc.setQueryData<CaseData[]>(CASES_KEY, (old) =>
        old ? old.map((c) => (c.id === updated.id ? updated : c)) : [updated],
      );
      qc.invalidateQueries({ queryKey: versionsKey(caseId) });
    },
  });
}

// ---- Flakiness hooks ----
//
// The score is computed from the test_runs table server-side, so we
// cache it for 30s — short enough that a new run shows up promptly,
// long enough that bouncing between the list and detail page doesn't
// re-hit the DB.

const flakinessKey = (caseId: number) => ['cases', caseId, 'flakiness'] as const;
const flakyListKey = (threshold: number) => ['flaky-cases', threshold] as const;

export function useFlakiness(caseId: number) {
  return useQuery({
    queryKey: flakinessKey(caseId),
    queryFn: () => fetchFlakiness(caseId),
    staleTime: 30_000,
    enabled: Number.isFinite(caseId),
  });
}

export function useFlakyList(threshold = 50) {
  return useQuery({
    queryKey: flakyListKey(threshold),
    queryFn: () => fetchFlakyList(threshold),
    staleTime: 30_000,
  });
}
