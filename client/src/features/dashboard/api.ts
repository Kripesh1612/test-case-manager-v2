// Thin wrappers over http for the /dashboard data fan-out.
//
// We re-use the existing /test-cases client (see features/cases/api.ts)
// and add small wrappers for /test-suites and /runs/recent. The recent
// runs endpoint is fail-soft: if it's down or returns non-JSON we
// surface an empty list so the rest of the dashboard keeps rendering.

import { http } from '@/lib/http';

export interface SuiteSummary {
  id: number;
  name: string;
  description?: string;
  test_case_ids: number[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface RecentRun {
  id: number;
  status: 'passed' | 'failed' | 'running' | string;
  started_at: string;
  test_case: { id: number; title: string; deleted_at?: string | null } | null;
  run_by: { id: number; email: string; name: string | null; role: string } | null;
}

export interface RecentRunsResponse {
  days: number;
  count: number;
  runs: RecentRun[];
}

export async function fetchSuites(): Promise<SuiteSummary[]> {
  const { data } = await http.get<SuiteSummary[]>('/test-suites');
  return data;
}

export async function fetchRecentRuns(days = 7): Promise<RecentRun[]> {
  try {
    const { data } = await http.get<RecentRunsResponse>(`/runs/recent?days=${days}`);
    return data.runs ?? [];
  } catch {
    return [];
  }
}