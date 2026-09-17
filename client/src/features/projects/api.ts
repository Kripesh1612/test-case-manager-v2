// API wrapper for the projects management page (Feature 4).
//
// Server:
//   GET   /projects                (admin) — all projects + counts
//   POST  /projects                (admin) — create { name, slug?, description? }
//   PATCH /projects/:id            (admin) — rename / re-slug / description
//   POST  /projects/:id/switch     (admin) — set my active project
//
// The switcher mutates the admin's own user.project_id; middleware/auth
// re-pins every subsequent request to the new project.

import { http } from '@/lib/http';

export interface Project {
  id: number;
  name: string;
  slug: string;
  description: string | null;
  created_at: string;
  members: number;
  test_cases: number;
  test_suites: number;
  scheduled_jobs: number;
  webhooks: number;
}

export async function fetchProjects(): Promise<Project[]> {
  const { data } = await http.get<Project[]>('/projects');
  return data ?? [];
}

export async function createProject(input: { name: string; slug?: string; description?: string }): Promise<Project> {
  const { data } = await http.post<Project>('/projects', input);
  return data;
}

export async function renameProject(id: number, input: { name?: string; slug?: string; description?: string }): Promise<Project> {
  const { data } = await http.patch<Project>(`/projects/${id}`, input);
  return data;
}

export async function switchProject(id: number): Promise<{ projectId: number; project_name: string }> {
  const { data } = await http.post<{ projectId: number; project_name: string }>(`/projects/${id}/switch`);
  return data;
}