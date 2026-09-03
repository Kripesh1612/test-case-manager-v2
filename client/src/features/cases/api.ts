// Thin wrapper over http for the /test-cases resource.
//
// We re-use the shared Zod schema as the source of truth for input
// shapes — same schema that validates the request on the server.

import { z } from 'zod';

import { http } from '@/lib/http';
import {
  PRIORITY_VALUES,
  RESULT_VALUES,
  STATUS_VALUES,
  testCaseSchema,
  testCaseUpdateSchema,
} from '@shared/schemas/testCase';

export const caseResponseSchema = testCaseSchema.extend({
  id: z.number().int().positive(),
  created_at: z.string(),
  updated_at: z.string(),
  deleted_at: z.string().nullable().optional(),
  last_run_at: z.string().nullable().optional(),
  result: z.enum(RESULT_VALUES),
  // Phase 8 — server persists the raw JS string verbatim; the shared
  // schema coerces null defaults from the form too.
  executable_snippet: z.string().nullable().optional(),
});

export type CaseData = z.infer<typeof caseResponseSchema>;
export type CaseCreateInput = z.infer<typeof testCaseSchema>;
export type CaseUpdateInput = z.infer<typeof testCaseUpdateSchema>;

export { STATUS_VALUES, PRIORITY_VALUES, RESULT_VALUES };

export async function fetchCases(): Promise<CaseData[]> {
  const { data } = await http.get<CaseData[]>('/test-cases');
  return data;
}

export async function fetchCase(id: number): Promise<CaseData> {
  const { data } = await http.get<CaseData>(`/test-cases/${id}`);
  return data;
}

export async function createCase(input: CaseCreateInput): Promise<CaseData> {
  const { data } = await http.post<CaseData>('/test-cases', input);
  return data;
}

export async function updateCase(id: number, input: CaseUpdateInput): Promise<CaseData> {
  const { data } = await http.put<CaseData>(`/test-cases/${id}`, input);
  return data;
}

export async function deleteCase(id: number): Promise<void> {
  await http.delete(`/test-cases/${id}`);
}

// ---- Versioning ----
//
// The server snapshots a TestCase on every create + every update, and
// exposes:
//   GET  /test-cases/:caseId/versions                 → list (newest first)
//   GET  /test-cases/:caseId/versions/:versionId      → one + snapshot
//   GET  /test-cases/:caseId/versions/:a/diff/:b      → field-by-field diff
//   POST /test-cases/:caseId/versions/:versionId/restore → admin/editor
//
// Restore runs server-side and returns the updated live row (same shape
// as fetchCase). We don't optimistically patch the cache on restore —
// the server snapshots the post-restore state too, so a refetch is the
// simplest correct behaviour.

// Subset of CaseData we actually version (kept in sync with the server's
// caseSnapshotSchema in shared/schemas/caseVersion.js).
export interface CaseSnapshot {
  title: string;
  description: string;
  steps: string[];
  expected_result: string;
  status: 'draft' | 'active' | 'deprecated';
  priority: 'low' | 'medium' | 'high';
  tags: string[];
}

export interface CaseVersionSummary {
  id: number;
  case_id: number;
  version: number;
  created_at: string;
  created_by_id: number | null;
}

export interface CaseVersionDetail extends CaseVersionSummary {
  snapshot: CaseSnapshot;
}

export type DiffKind = 'changed' | 'added' | 'removed';

export interface DiffField {
  field: 'title' | 'description' | 'steps' | 'expected_result' | 'priority' | 'status' | 'tags';
  kind: DiffKind;
  before: string[];
  after: string[];
}

export interface CaseDiff {
  from_version: number;
  to_version: number;
  fields: DiffField[];
}

export async function fetchVersions(caseId: number): Promise<CaseVersionSummary[]> {
  const { data } = await http.get<CaseVersionSummary[]>(`/test-cases/${caseId}/versions`);
  return data;
}

export async function fetchVersion(caseId: number, versionId: number): Promise<CaseVersionDetail> {
  const { data } = await http.get<CaseVersionDetail>(`/test-cases/${caseId}/versions/${versionId}`);
  return data;
}

export async function fetchDiff(
  caseId: number,
  fromVersionId: number,
  toVersionId: number,
): Promise<CaseDiff> {
  const { data } = await http.get<CaseDiff>(
    `/test-cases/${caseId}/versions/${fromVersionId}/diff/${toVersionId}`,
  );
  return data;
}

export async function restoreVersion(caseId: number, versionId: number): Promise<CaseData> {
  const { data } = await http.post<CaseData>(`/test-cases/${caseId}/versions/${versionId}/restore`);
  return data;
}

// ---- Flakiness ----

export type FlakinessVerdict =
  | 'stable'
  | 'possibly_flaky'
  | 'flaky'
  | 'very_flaky'
  | 'broken'
  | 'insufficient_data';

export interface FlakinessWindow {
  window_size: number;
  passed: number;
  failed: number;
  pass_rate: number;
}

export interface FlakinessSignals {
  disagreement: number;
  switch_rate: number;
  late_failure: number;
}

export interface FlakinessReport {
  case_id: number;
  score: number | null;
  verdict: FlakinessVerdict;
  sample_size: number;
  recent: FlakinessWindow;
  baseline: FlakinessWindow;
  signals: FlakinessSignals;
  last_run_at: string | null;
  last_run_status: 'passed' | 'failed' | null;
}

export interface FlakyCaseEntry {
  case_id: number;
  title: string;
  score: number | null;
  verdict: FlakinessVerdict;
  sample_size: number;
  last_run_status: 'passed' | 'failed' | null;
}

export interface FlakyList {
  threshold: number;
  count: number;
  cases: FlakyCaseEntry[];
}

export async function fetchFlakiness(caseId: number): Promise<FlakinessReport> {
  const { data } = await http.get<FlakinessReport>(`/test-cases/${caseId}/flakiness`);
  return data;
}

export async function fetchFlakyList(threshold = 50): Promise<FlakyList> {
  const { data } = await http.get<FlakyList>(`/test-cases/flaky?threshold=${threshold}`);
  return data;
}
