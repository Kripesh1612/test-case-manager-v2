// TanStack Query hooks for the email digest admin page.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { fetchDigestHistory, previewDigest, sendDigestNow } from './api';

const digestKey = ['digest'] as const;

export function useDigestHistory() {
  return useQuery({
    queryKey: digestKey,
    queryFn: fetchDigestHistory,
    staleTime: 15_000,
  });
}

export function useDigestPreview() {
  return useQuery({
    queryKey: ['digest', 'preview'] as const,
    queryFn: previewDigest,
    enabled: false,
    staleTime: 0,
  });
}

export function useSendDigest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => sendDigestNow(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: digestKey });
      qc.invalidateQueries({ queryKey: ['digest', 'preview'] as const });
    },
  });
}