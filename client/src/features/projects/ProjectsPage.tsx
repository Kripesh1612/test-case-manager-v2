// =============================================================================
// /admin/projects — project management (Feature 4).
//
// Projects are the tenant boundary: every user, test case, suite, job,
// webhook, digest, invite and audit event belongs to one project. Admins
// use this page to create/rename projects and to *switch* their active
// project ("where am I working right now?"). The switch persists to the
// admin's user.row, so the next page load keeps the same project.
//
// data-cy contract:
//   projects-new-btn / projects-form-card / project-name-input
//   project-slug-input / project-description-input / project-save-btn
//   projects-table / project-row / project-name / project-active
//   project-set-active / project-members / project-cases / project-edit
//   projects-empty
// =============================================================================

import { useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { showToast } from '@/lib/toast';
import { useAuth } from '@/hooks/useAuth';

import type { Project } from './api';
import { useCreateProject, useProjects, useRenameProject, useSwitchProject } from './hooks';

export function ProjectsPage() {
  const { user, refetch } = useAuth();
  const q = useProjects();
  const projects = q.data ?? [];

  const createM = useCreateProject();
  const renameM = useRenameProject();
  const switchM = useSwitchProject();

  // Form state: `editing` is undefined for create, or the project row being renamed.
  const [editing, setEditing] = useState<Project | undefined>(undefined);
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);

  const activeId = user?.projectId ?? null;

  function openCreate() {
    setEditing(undefined);
    setName('');
    setSlug('');
    setDescription('');
    setFormOpen(true);
  }

  function openEdit(p: Project) {
    setEditing(p);
    setName(p.name);
    setSlug(p.slug);
    setDescription(p.description ?? '');
    setFormOpen(true);
  }

  const submit = async () => {
    if (!name.trim()) {
      showToast({ message: 'Project name is required', variant: 'error' });
      return;
    }
    setBusy(true);
    try {
      if (editing) {
        await renameM.mutateAsync({
          id: editing.id,
          name: name.trim(),
          slug: slug.trim() || undefined,
          description: description.trim() || undefined,
        });
        showToast({ message: 'Project updated', variant: 'success' });
      } else {
        await createM.mutateAsync({ name: name.trim(), slug: slug.trim() || undefined, description: description.trim() || undefined });
        showToast({ message: 'Project created', variant: 'success' });
      }
      setFormOpen(false);
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      showToast({ message: msg ?? 'Failed to save project', variant: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const setActive = async (p: Project) => {
    try {
      await switchM.mutateAsync(p.id);
      await refetch();
      showToast({ message: `Active project switched to ${p.name}`, variant: 'success' });
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      showToast({ message: msg ?? 'Failed to switch project', variant: 'error' });
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Workspace"
        title="Projects"
        description="Projects are the tenant boundary. Everything you see — cases, suites, jobs, webhooks, digests, invites, audit — belongs to your active project. Switch projects to change workspace."
        actions={
          <Button variant="primary" size="sm" data-cy="projects-new-btn" onClick={openCreate}>
            <Icon.Plus size={14} /> New project
          </Button>
        }
      />

      {formOpen && (
        <Card className="p-4" data-cy="projects-form-card">
          <h3 className="mb-3 text-sm font-semibold text-text">
            {editing ? `Rename ${editing.name}` : 'Create a project'}
          </h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <label className="block text-xs font-medium text-text-secondary">
              Name *
              <input
                data-cy="project-name-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Growth QA"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand"
              />
            </label>
            <label className="block text-xs font-medium text-text-secondary">
              Slug (URL-safe identifier)
              <input
                data-cy="project-slug-input"
                value={slug}
                onChange={(e) => setSlug(e.target.value)}
                placeholder="growth-qa"
                className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand"
              />
            </label>
          </div>
          <label className="mt-3 block text-xs font-medium text-text-secondary">
            Description
            <textarea
              data-cy="project-description-input"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="mt-1 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-brand"
            />
          </label>
          <div className="mt-4 flex gap-2">
            <Button variant="brand" size="sm" loading={busy} data-cy="project-save-btn" onClick={submit}>
              {editing ? 'Save changes' : 'Create project'}
            </Button>
            <Button size="sm" onClick={() => setFormOpen(false)}>
              Cancel
            </Button>
          </div>
        </Card>
      )}

      {q.error && (
        <div className="flex items-start gap-3 rounded-lg border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <Icon.Warning size={16} />
          <div>
            <strong className="font-semibold">Failed to load</strong>
            <p className="mt-0.5 text-xs opacity-90">{(q.error as Error).message}</p>
          </div>
        </div>
      )}

      {projects.length === 0 && !q.isLoading && (
        <Card data-cy="projects-empty">
          <EmptyState
            icon={<Icon.Box size={20} />}
            title="No projects yet"
            description="Create the first project to start splitting work across tenants."
          />
        </Card>
      )}

      {projects.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-cy="projects-table">
              <thead className="bg-surface-sunken text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5 font-medium">Members</th>
                  <th className="px-5 py-2.5 font-medium">Cases</th>
                  <th className="px-5 py-2.5 font-medium">Suites</th>
                  <th className="px-5 py-2.5 font-medium">Jobs</th>
                  <th className="px-5 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {projects.map((p) => {
                  const isActive = p.id === activeId;
                  return (
                    <tr
                      key={p.id}
                      data-cy="project-row"
                      data-project-id={p.id}
                      data-active={isActive}
                      className={`transition-colors hover:bg-surface-hover ${isActive ? 'bg-surface-hover' : ''}`}
                    >
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-2">
                          <Icon.Box size={14} className="text-text-tertiary" />
                          <span data-cy="project-name" className="font-medium text-text">{p.name}</span>
                          {isActive && (
                            <span data-cy="project-active" className="rg-pill rg-pill-result-passed">
                              active
                            </span>
                          )}
                          {p.slug !== 'default' && (
                            <span className="text-xs text-text-tertiary">/{p.slug}</span>
                          )}
                        </div>
                        {p.description && (
                          <p className="mt-0.5 text-xs text-text-secondary">{p.description}</p>
                        )}
                      </td>
                      <td data-cy="project-members" className="px-5 py-3 text-text-secondary">{p.members}</td>
                      <td data-cy="project-cases" className="px-5 py-3 text-text-secondary">{p.test_cases}</td>
                      <td className="px-5 py-3 text-text-secondary">{p.test_suites}</td>
                      <td className="px-5 py-3 text-text-secondary">{p.scheduled_jobs}</td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        <div className="flex items-center justify-end gap-2">
                          <button type="button" data-cy="project-edit" className="btn small" onClick={() => openEdit(p)}>
                            Edit
                          </button>
                          {isActive ? (
                            <span className="text-xs text-text-tertiary">current</span>
                          ) : (
                            <button
                              type="button"
                              data-cy="project-set-active"
                              className="btn small"
                              onClick={() => setActive(p)}
                            >
                              <Icon.Run size={13} /> Set active
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}