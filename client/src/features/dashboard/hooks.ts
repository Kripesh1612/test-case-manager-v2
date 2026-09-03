// TanStack Query hook for the dashboard's three data sources.
//
// Fanned out in parallel via Promise.all so the page renders as soon as
// all three settle. /runs/recent fails soft inside its API wrapper, so
// cases + suites are the only thing the page needs to wait on for a
// meaningful render.

import { useQuery } from '@tanstack/react-query';

import { useCases } from '@/features/cases/hooks';
import type { CaseData } from '@/features/cases/api';

import type { RecentRun, SuiteSummary } from './api';
import { fetchRecentRuns, fetchSuites } from './api';

const SUITES_KEY = ['test-suites'] as const;
const RECENT_RUNS_KEY = ['runs', 'recent', 7] as const;

export function useSuites() {
  return useQuery({
    queryKey: SUITES_KEY,
    queryFn: fetchSuites,
    staleTime: 30_000,
  });
}

export function useRecentRuns() {
  return useQuery({
    queryKey: RECENT_RUNS_KEY,
    queryFn: () => fetchRecentRuns(7),
    staleTime: 30_000,
  });
}

export interface DashboardData {
  cases: CaseData[];
  suites: SuiteSummary[];
  recentRuns: RecentRun[];
}

export function useDashboardData() {
  const casesQ = useCases();
  const suitesQ = useSuites();
  const runsQ = useRecentRuns();

  return {
    casesQ,
    suitesQ,
    runsQ,
    data: {
      cases: casesQ.data ?? [],
      suites: suitesQ.data ?? [],
      recentRuns: runsQ.data ?? [],
    },
    isLoading: casesQ.isLoading || suitesQ.isLoading,
  };
}