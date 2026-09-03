// Thin wrappers over http for the /trash resource.
//
// The /trash router on the server exposes only soft-deleted rows; the
// API returns the same shape as the parent resource plus `deleted_at`
// populated. We don't re-use the regular case/suite schemas here
// because deleted rows are read-only and we only need a few fields for
// the listing UI (id, title|name, deleted_at).

import { http } from '@/lib/http';

export interface TrashedCase {
  id: number;
  title: string;
  deleted_at: string | null;
}

export interface TrashedSuite {
  id: number;
  name: string;
  deleted_at: string | null;
}

export interface TrashCasesResponse {
  count: number;
  cases: TrashedCase[];
}

export interface TrashSuitesResponse {
  count: number;
  suites: TrashedSuite[];
}

export async function fetchTrashedCases(): Promise<TrashCasesResponse> {
  const { data } = await http.get<TrashCasesResponse>('/trash/cases');
  return data;
}

export async function fetchTrashedSuites(): Promise<TrashSuitesResponse> {
  const { data } = await http.get<TrashSuitesResponse>('/trash/suites');
  return data;
}

export async function restoreCase(id: number): Promise<void> {
  await http.post(`/trash/cases/${id}/restore`);
}

export async function restoreSuite(id: number): Promise<void> {
  await http.post(`/trash/suites/${id}/restore`);
}

export async function purgeCase(id: number): Promise<void> {
  await http.delete(`/trash/cases/${id}`);
}

export async function purgeSuite(id: number): Promise<void> {
  await http.delete(`/trash/suites/${id}`);
}