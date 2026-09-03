// TanStack Query hooks for the /scheduled-jobs resource.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import type {
  ScheduledJob,
  ScheduledJobCreateInput,
  ScheduledJobUpdateInput,
} from './api';
import {
  createJob,
  deleteJob,
  fetchHistory,
  fetchJobs,
  runJob,
  updateJob,
} from './api';

const JOBS_KEY = ['scheduled-jobs'] as const;

export function useJobs() {
  return useQuery({
    queryKey: JOBS_KEY,
    queryFn: fetchJobs,
    staleTime: 30_000,
  });
}

export function useCreateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: ScheduledJobCreateInput) => createJob(input),
    onSuccess: (created) => {
      qc.setQueryData<ScheduledJob[]>(JOBS_KEY, (old) =>
        old ? [...old, created] : [created],
      );
    },
  });
}

export function useUpdateJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: ScheduledJobUpdateInput }) =>
      updateJob(id, input),
    onSuccess: (updated) => {
      qc.setQueryData<ScheduledJob[]>(JOBS_KEY, (old) =>
        old ? old.map((j) => (j.id === updated.id ? updated : j)) : [updated],
      );
    },
  });
}

export function useDeleteJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => deleteJob(id),
    onSuccess: (_void, id) => {
      qc.setQueryData<ScheduledJob[]>(JOBS_KEY, (old) =>
        old ? old.filter((j) => j.id !== id) : [],
      );
    },
  });
}

export function useRunJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => runJob(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['cases'] });
      qc.invalidateQueries({ queryKey: ['runs', 'recent'] });
      qc.invalidateQueries({ queryKey: JOBS_KEY });
    },
  });
}

export function useJobHistory(id: number, enabled: boolean) {
  return useQuery({
    queryKey: ['scheduled-jobs', id, 'history'],
    queryFn: () => fetchHistory(id),
    enabled,
  });
}
