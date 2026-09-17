// TanStack Query hooks for the visual-regression page.

import { useQuery } from '@tanstack/react-query';

import { fetchVisualRuns } from './api';

export function useVisualRuns() {
  return useQuery({
    queryKey: ['visual', 'runs'] as const,
    queryFn: fetchVisualRuns,
    staleTime: 15_000,
  });
}