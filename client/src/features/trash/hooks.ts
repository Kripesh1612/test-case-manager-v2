// TanStack Query hooks for /trash.
//
// `useTrashData` fans out two parallel queries (cases + suites) into a
// single shape the page renders. `useRestoreItem` / `usePurgeItem` are
// generic over "case" or "suite" so the page wires one pair of hooks
// and calls them with the kind argument. Both mutations invalidate the
// trash query on success so the row disappears / reappears without a
// manual refetch.
//
// `useRestoreCase` / `useRestoreSuite` / `usePurgeCase` / `usePurgeSuite`
// are convenience wrappers — kept separate so the cache invalidation
// can be specific (e.g. restore a case shouldn't refetch suites).

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import {
  fetchTrashedCases,
  fetchTrashedSuites,
  purgeCase,
  purgeSuite,
  restoreCase,
  restoreSuite,
  type TrashedCase,
  type TrashedSuite,
} from './api';

const TRASH_KEY = ['trash'] as const;

export interface TrashData {
  cases: TrashedCase[];
  suites: TrashedSuite[];
}

export function useTrashData() {
  const casesQ = useQuery({
    queryKey: [...TRASH_KEY, 'cases'] as const,
    queryFn: fetchTrashedCases,
    staleTime: 15_000,
  });
  const suitesQ = useQuery({
    queryKey: [...TRASH_KEY, 'suites'] as const,
    queryFn: fetchTrashedSuites,
    staleTime: 15_000,
  });

  return {
    casesQ,
    suitesQ,
    data: {
      cases: casesQ.data?.cases ?? [],
      suites: suitesQ.data?.suites ?? [],
    },
    isLoading: casesQ.isLoading || suitesQ.isLoading,
  };
}

export function useRestoreCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => restoreCase(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TRASH_KEY });
      qc.invalidateQueries({ queryKey: ['cases'] });
    },
  });
}

export function useRestoreSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => restoreSuite(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TRASH_KEY });
      qc.invalidateQueries({ queryKey: ['test-suites'] });
    },
  });
}

export function usePurgeCase() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => purgeCase(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TRASH_KEY });
    },
  });
}

export function usePurgeSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => purgeSuite(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: TRASH_KEY });
    },
  });
}