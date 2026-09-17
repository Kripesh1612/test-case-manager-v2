// API wrapper for the webhooks admin page.
//
// Server:
//   GET  /webhooks/:id/deliveries   — 50 most recent delivery rows
//   GET  /webhooks                  — admin-only list (with delivery counts)
//   POST /webhooks                  — create a webhook (admin only)
//   POST /webhooks/:id/test         — fire a ping to verify delivery works
//   PUT  /webhooks/:id              — update (admin only)
//   DELETE /webhooks/:id            — hard delete (admin only)

import { http } from '@/lib/http';

export interface Webhook {
  id: number;
  url: string;
  event: string;
  enabled: boolean;
  project_id: number;
  created_by_id: number | null;
  created_at: string;
  updated_at: string;
  has_secret: boolean;
  delivery_count: number;
}

export interface WebhookDelivery {
  id: number;
  webhook_id: number;
  event: string;
  payload: unknown;
  status_code: number | null;
  success: boolean;
  error: string | null;
  created_at: string;
}

export interface WebhookCreateInput {
  url: string;
  secret?: string;
  event?: string;
  enabled?: boolean;
}

export interface WebhookUpdateInput {
  url?: string;
  secret?: string;
  event?: string;
  enabled?: boolean;
}

export async function fetchWebhooks(): Promise<Webhook[]> {
  const { data } = await http.get<Webhook[]>('/webhooks');
  return data ?? [];
}

export async function createWebhook(input: WebhookCreateInput): Promise<Webhook> {
  const { data } = await http.post<Webhook>('/webhooks', input);
  return data;
}

export async function updateWebhook(id: number, input: WebhookUpdateInput): Promise<Webhook> {
  const { data } = await http.put<Webhook>(`/webhooks/${id}`, input);
  return data;
}

export async function deleteWebhook(id: number): Promise<void> {
  await http.delete(`/webhooks/${id}`);
}

export async function testWebhook(id: number): Promise<{ ok: boolean; attempts: number }> {
  const { data } = await http.post<{ ok: boolean; attempts: number }>(`/webhooks/${id}/test`);
  return data;
}

export async function fetchWebhookDeliveries(id: number): Promise<WebhookDelivery[]> {
  const { data } = await http.get<WebhookDelivery[]>(`/webhooks/${id}/deliveries`);
  return data ?? [];
}