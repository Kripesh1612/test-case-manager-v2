// Thin wrappers over http for the /test-suites resource.
//
// The shared Zod schema (see @shared/schemas/testSuite) is the source of
// truth for input shapes — the same schemas validate on the server.

import { http } from '@/lib/http';

export interface Suite {
  id: number;
  name: string;
  description?: string;
  test_case_ids: number[];
  created_at: string;
  updated_at: string;
  deleted_at?: string | null;
}

export interface SuiteCreateInput {
  name: string;
  description?: string;
  test_case_ids?: number[];
}

export interface SuiteUpdateInput {
  name?: string;
  description?: string;
  test_case_ids?: number[];
}

export interface SuiteRunResponse {
  updated: number;
  run_id?: number;
}

export async function fetchSuites(): Promise<Suite[]> {
  const { data } = await http.get<Suite[]>('/test-suites');
  return data;
}

export async function fetchSuite(id: number): Promise<Suite> {
  const { data } = await http.get<Suite>(`/test-suites/${id}`);
  return data;
}

export async function createSuite(input: SuiteCreateInput): Promise<Suite> {
  const { data } = await http.post<Suite>('/test-suites', input);
  return data;
}

export async function updateSuite(id: number, input: SuiteUpdateInput): Promise<Suite> {
  const { data } = await http.put<Suite>(`/test-suites/${id}`, input);
  return data;
}

export async function deleteSuite(id: number): Promise<void> {
  await http.delete(`/test-suites/${id}`);
}

export async function runSuite(id: number, result: 'passed' | 'failed' = 'passed'): Promise<SuiteRunResponse> {
  const { data } = await http.post<SuiteRunResponse>(`/test-suites/${id}/run`, { result });
  return data;
}
