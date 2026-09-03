// Thin wrappers over http for the /scheduled-jobs resource.

import { http } from '@/lib/http';

export interface SuiteStub {
  id: number;
  name: string;
}

export interface ScheduledJob {
  id: number;
  name: string;
  cron: string;
  timezone?: string;
  suite_id: number;
  suite?: SuiteStub | null;
  enabled: boolean;
  max_retries: number;
  retry_count?: number;
  last_error?: string | null;
  last_run_at?: string | null;
  next_run_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ScheduledJobCreateInput {
  name: string;
  cron: string;
  timezone?: string;
  suite_id: number;
  enabled?: boolean;
  max_retries?: number;
}

export interface ScheduledJobUpdateInput {
  name?: string;
  cron?: string;
  timezone?: string;
  suite_id?: number;
  enabled?: boolean;
  max_retries?: number;
}

export interface ScheduledJobRunResponse {
  runs_created: number;
  run_id?: number;
}

export interface HistoryEvent {
  created_at: string;
  actor_id?: number | null;
  ip?: string | null;
}

export interface HistoryResponse {
  count: number;
  events: HistoryEvent[];
}

export async function fetchJobs(): Promise<ScheduledJob[]> {
  const { data } = await http.get<ScheduledJob[]>('/scheduled-jobs');
  return data;
}

export async function createJob(input: ScheduledJobCreateInput): Promise<ScheduledJob> {
  const { data } = await http.post<ScheduledJob>('/scheduled-jobs', input);
  return data;
}

export async function updateJob(id: number, input: ScheduledJobUpdateInput): Promise<ScheduledJob> {
  const { data } = await http.patch<ScheduledJob>(`/scheduled-jobs/${id}`, input);
  return data;
}

export async function deleteJob(id: number): Promise<void> {
  await http.delete(`/scheduled-jobs/${id}`);
}

export async function runJob(id: number): Promise<ScheduledJobRunResponse> {
  const { data } = await http.post<ScheduledJobRunResponse>(`/scheduled-jobs/${id}/run`);
  return data;
}

export async function fetchHistory(id: number): Promise<HistoryResponse> {
  const { data } = await http.get<HistoryResponse>(`/scheduled-jobs/${id}/history`);
  return data;
}
