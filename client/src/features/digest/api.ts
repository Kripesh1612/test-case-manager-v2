// API wrapper for the email digest admin page.
//
// Server (admin only):
//   GET  /digest          — digest_logs history (30 most recent)
//   POST /digest/send     — compose + send a digest now
//   POST /digest/preview  — compose without persisting (for the UI preview)

import { http } from '@/lib/http';

export interface DigestSection {
  key: string;
  label: string;
  count: number;
}

export interface DigestSummary {
  window_start: string;
  window_end: string;
  title: string;
  sections: DigestSection[];
}

export interface DigestLog {
  id: number;
  project_id: number;
  sent_at: string;
  recipients: string[];
  summary: DigestSummary;
}

export interface DigestPreview {
  window_start: string;
  window_end: string;
  project_id: number;
  recipients: string[];
  title: string;
  sections: DigestSection[];
  html: string;
}

export interface DigestSendResult {
  log_id: number;
  project_id: number;
  sent_at: string;
  recipients: string[];
  title: string;
  sections: DigestSection[];
  delivery?: { delivered: boolean; artifact?: string; error?: string };
}

export async function fetchDigestHistory(): Promise<DigestLog[]> {
  const { data } = await http.get<DigestLog[]>('/digest');
  return data ?? [];
}

export async function previewDigest(): Promise<DigestPreview> {
  const { data } = await http.post<DigestPreview>('/digest/preview');
  return data;
}

export async function sendDigestNow(): Promise<DigestSendResult> {
  const { data } = await http.post<DigestSendResult>('/digest/send');
  return data;
}