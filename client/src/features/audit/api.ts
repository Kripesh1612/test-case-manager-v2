// API wrapper for the audit log page.
//
// Server: GET /audit returns { total, limit, offset, events: [...] }
// where each event has actor + before/after snapshot (admin-only).
// Optional filters: actor_id, target_type, target_id, action.

import { http } from '@/lib/http';

export interface AuditActor {
  id: number;
  email: string;
  name: string | null;
  role: 'admin' | 'editor' | 'viewer';
}

export interface AuditEvent {
  id: number;
  action: string;
  target_type: string | null;
  target_id: number | null;
  actor: AuditActor | null;
  ip: string | null;
  user_agent: string | null;
  before: unknown | null;
  after: unknown | null;
  created_at: string;
}

export interface AuditListResponse {
  total: number;
  limit: number;
  offset: number;
  events: AuditEvent[];
}

export interface AuditFilters {
  actor_id?: number;
  target_type?: string;
  target_id?: number;
  action?: string;
  limit?: number;
  offset?: number;
}

export async function fetchAuditEvents(filters: AuditFilters = {}): Promise<AuditListResponse> {
  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(filters)) {
    if (v != null && v !== '') params[k] = String(v);
  }
  const { data } = await http.get<AuditListResponse>('/audit', { params });
  return data;
}

export async function fetchAuditActions(): Promise<string[]> {
  const { data } = await http.get<{ actions: string[] }>('/audit/actions');
  return data.actions ?? [];
}
