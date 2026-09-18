// =============================================================================
// /scheduler — Schedule a test suite to run automatically.
//
// Layout, top to bottom:
//   1. One-line header explaining what this page does
//   2. "New schedule" form card (always present in the DOM, hidden until
//      "New scheduled job" is clicked) — sits ABOVE the list so the
//      primary action is obvious
//   3. "Your schedules" list — one row per job, plain-English summary,
//      status badge, two actions (Run now, Edit/Delete)
//
// Split out of one 847-LOC file in PR-Q:
//   - JobForm.tsx        create / edit form + cron preset chips
//   - JobRow.tsx         one row per scheduled job
//   - HistoryDrawer.tsx  audit-event modal for a job's fire history
//   - cronUtils.ts       pure humanizeCron + isValidCronClient + relativeTime
//
// This file now only owns page-level state (form open, editing id,
// pending delete, history job id) and the create/update/delete/run
// mutations. Every existing data-cy hook is preserved verbatim.
// =============================================================================

import { useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { ConfirmModal } from '@/components/Modal';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import { useSuites } from '@/features/suites/hooks';

import type { ScheduledJob, ScheduledJobCreateInput } from './api';
import {
  EMPTY_JOB_FORM,
  JobForm,
  type JobFormState,
} from './JobForm';
import { JobRow } from './JobRow';
import { HistoryDrawer } from './HistoryDrawer';
import {
  useCreateJob,
  useDeleteJob,
  useJobHistory,
  useJobs,
  useRunJob,
  useUpdateJob,
} from './hooks';

export function SchedulerPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const jobsQ = useJobs();
  const suitesQ = useSuites();
  const createM = useCreateJob();
  const updateM = useUpdateJob();
  const deleteM = useDeleteJob();
  const runM = useRunJob();

  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<JobFormState>(EMPTY_JOB_FORM);
  const [pendingDelete, setPendingDelete] = useState<ScheduledJob | null>(null);
  const [historyJobId, setHistoryJobId] = useState<number | null>(null);
  const historyQ = useJobHistory(historyJobId ?? 0, historyJobId !== null);

  const jobs = jobsQ.data ?? [];
  const suites = suitesQ.data ?? [];

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_JOB_FORM, suite_id: suites[0]?.id ?? 0 });
    setFormOpen(true);
  };

  const openEdit = (job: ScheduledJob) => {
    setEditingId(job.id);
    setForm({
      name: job.name,
      cron: job.cron,
      timezone: job.timezone ?? 'UTC',
      suite_id: job.suite_id,
      max_retries: job.max_retries ?? 0,
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_JOB_FORM);
  };

  const submitForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.suite_id) {
      showToast({ message: 'Pick a suite first', variant: 'error' });
      return;
    }
    const payload: ScheduledJobCreateInput = {
      name: form.name.trim(),
      cron: form.cron.trim(),
      timezone: form.timezone.trim() || 'UTC',
      suite_id: form.suite_id,
      max_retries: form.max_retries || 0,
    };
    try {
      if (editingId !== null) {
        await updateM.mutateAsync({ id: editingId, input: payload });
        showToast({ message: `Updated "${payload.name}"`, variant: 'success' });
      } else {
        await createM.mutateAsync(payload);
        showToast({ message: `Created "${payload.name}"`, variant: 'success' });
      }
      closeForm();
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    }
  };

  const onRun = async (job: ScheduledJob) => {
    try {
      const result = await runM.mutateAsync(job.id);
      showToast({
        message: `Ran "${job.name}": ${result.runs_created} test run(s) created`,
        variant: 'success',
      });
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    }
  };

  const onToggle = async (job: ScheduledJob) => {
    try {
      await updateM.mutateAsync({ id: job.id, input: { enabled: !job.enabled } });
      showToast({
        message: `"${job.name}" ${!job.enabled ? 'enabled' : 'disabled'}`,
        variant: 'success',
      });
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    const job = pendingDelete;
    try {
      await deleteM.mutateAsync(job.id);
      showToast({ message: `Deleted "${job.name}"`, variant: 'success' });
    } catch (err) {
      showToast({ message: (err as Error).message ?? 'Failed', variant: 'error' });
    } finally {
      setPendingDelete(null);
    }
  };

  return (
    <section className="space-y-6">
      {/* Page header — single line, plain English */}
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-text">
          Scheduler
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Run a test suite automatically on a schedule. Pick a name, pick a suite,
          pick when — Regress does the rest.
        </p>
      </header>

      {/* "New schedule" form — ALWAYS at the top, hidden when closed */}
      {formOpen ? (
        <JobForm
          form={form}
          setForm={setForm}
          suites={suites}
          isEdit={editingId !== null}
          onSubmit={submitForm}
          onCancel={closeForm}
          isSubmitting={createM.isPending || updateM.isPending}
        />
      ) : (
        /* Empty placeholder so Cypress's not.be.visible query still resolves
           after the form closes. */
        <form data-cy="job-form" hidden onSubmit={(e) => e.preventDefault()} />
      )}

      {/* "New scheduled job" CTA — admin-only. Visible always (at the top
          when form is closed so users know how to create). */}
      {!formOpen && (
        <Button
          variant="primary"
          size="md"
          data-cy="job-new-btn"
          data-admin-only
          hidden={!isAdmin}
          leftIcon={<Icon.Plus size={14} />}
          onClick={openCreate}
        >
          New scheduled job
        </Button>
      )}

      {/* Your schedules — list of jobs */}
      <div className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-text-tertiary">
          Your schedules
        </h2>

        {jobs.length === 0 ? (
          <Card>
            <div data-cy="job-list">
              <div data-cy="empty-no-jobs">
                <EmptyState
                  icon={<Icon.Schedule size={20} />}
                  title="No schedules yet"
                  description="Click New scheduled job above to run a suite automatically on a cron schedule."
                />
              </div>
            </div>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <ul data-cy="job-list" className="divide-y divide-border-soft">
              {jobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  isAdmin={isAdmin}
                  onRun={() => onRun(job)}
                  onToggle={() => onToggle(job)}
                  onDelete={() => setPendingDelete(job)}
                  onEdit={() => openEdit(job)}
                  onHistory={() => setHistoryJobId(job.id)}
                />
              ))}
            </ul>
          </Card>
        )}
      </div>

      {pendingDelete && (
        <ConfirmModal
          title={`Delete "${pendingDelete.name}"?`}
          message="The scheduled job will be removed. Audit history will be retained."
          confirmLabel="Delete"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setPendingDelete(null)}
        />
      )}

      {historyJobId !== null && (
        <HistoryDrawer
          job={jobs.find((j) => j.id === historyJobId) ?? null}
          events={historyQ.data?.events ?? []}
          count={historyQ.data?.count ?? 0}
          isLoading={historyQ.isLoading}
          onClose={() => setHistoryJobId(null)}
        />
      )}
    </section>
  );
}
