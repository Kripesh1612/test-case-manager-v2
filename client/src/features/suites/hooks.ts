// TanStack Query hooks for the /test-suites resource.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  Suite,
  SuiteCreateInput,
  SuiteUpdateInput,
} from './api';
import {
  createSuite,
  deleteSuite,
  fetchSuite,
  fetchSuites,
  runSuite,
  updateSuite,
} from './api';

const SUITES_KEY = ['test-suites'] as const;
const suiteKey = (id: number) => ['test-suites', id] as const;

export function useSuites() {
  return useQuery({
    queryKey: SUITES_KEY,
    queryFn: fetchSuites,
    staleTime: 30_000,
  });
}

export function useSuite(id: number) {
  return useQuery({
    queryKey: suiteKey(id),
    queryFn: () => fetchSuite(id),
    enabled: Number.isFinite(id) && id > 0,
  });
}

export function useCreateSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SuiteCreateInput) => createSuite(input),
    onSuccess: (created) => {
      qc.setQueryData<Suite[]>(SUITES_KEY, (old) => (old ? [...old, created] : [created]));
      qc.invalidateQueries({ queryKey: ['runs', 'recent'] });
    },
  });
}

export function useUpdateSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: SuiteUpdateInput }) =>
      updateSuite(id, input),
    onSuccess: (updated) => {
      qc.setQueryData<Suite[]>(SUITES_KEY, (old) =>
        old ? old.map((s) => (s.id === updated.id ? updated : s)) : [updated],
      );
      qc.setQueryData<Suite>(suiteKey(updated.id), updated);
    },
  });
}

export function useDeleteSuite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteSuite(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<Suite[]>(SUITES_KEY, (old) =>
        old ? old.filter((s) => s.id !== id) : [],
      );
      qc.removeQueries({ queryKey: suiteKey(id) });
    },
  });
}

export function useRunSuite(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => runSuite(id),
    onSuccess: () => {
      // Run affects the cases inside — invalidate them so badges refresh.
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['runs', 'recent'] });
      qc.invalidateQueries({ queryKey: suiteKey(id) });
    },
  });
}
