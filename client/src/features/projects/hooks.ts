// TanStack Query hooks for the projects management page.

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { createProject, fetchProjects, switchProject, renameProject } from './api';

export const PROJECTS_KEY = ['projects', 'list'] as const;

export function useProjects() {
  return useQuery({
    queryKey: PROJECTS_KEY,
    queryFn: fetchProjects,
    staleTime: 30_000,
  });
}

export function useCreateProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createProject,
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useRenameProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { id: number; name?: string; slug?: string; description?: string }) =>
      renameProject(vars.id, {
        name: vars.name ?? undefined,
        slug: vars.slug ?? undefined,
        description: vars.description ?? undefined,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: PROJECTS_KEY }),
  });
}

export function useSwitchProject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: switchProject,
    // After the admin's active project changes, everything is invalid:
    // the /me payload (project badge) and every domain query.
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['auth', 'me'] });
      qc.invalidateQueries();
    },
  });
}