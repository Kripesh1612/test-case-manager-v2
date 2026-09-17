// API wrapper for the visual-regression page.
//
// Server:
//   GET /visual/runs                — runs with a stored pixel diff (admin/editor)
//   GET /runs/:id/visual            — diff summary + artifact URLs
//   GET /runs/:id/artifacts/:name   — serve a stored PNG artifact
//   POST /runs/:id/visual/diff      — (admin) compute diff for a run
//   POST /runs/:id/artifacts/:name  — (admin) attach a base64 PNG screenshot

import { http } from '@/lib/http';

export interface VisualRun {
  run_id: number;
  case_id: number;
  case_title: string | null;
  status: string;
  finished_at: string | null;
  diff_score: number | null;
  verdict: 'identical' | 'minor' | 'significant' | null;
  screenshot_before: string | null;
  screenshot_after: string | null;
  diff_image: string | null;
  urls: {
    before: string | null;
    after: string | null;
    diff: string | null;
  };
}

export async function fetchVisualRuns(): Promise<VisualRun[]> {
  const { data } = await http.get<VisualRun[]>('/visual/runs');
  return data ?? [];
}