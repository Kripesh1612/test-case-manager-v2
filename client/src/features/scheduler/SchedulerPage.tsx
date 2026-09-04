// =============================================================================
// /scheduler — Scheduled jobs page.
//
// Lists cron-based scheduled jobs with per-row admin actions (run now,
// toggle, delete) plus a viewer-visible History button that opens a modal.
// Inline create/edit form with a live cron preview as the user types.
//
// Layout:
//   • PageHeader with title + admin-only "New job" CTA
//   • Collapsible cron syntax help (details element)
//   • Card-wrapped job list (EmptyState when there are no jobs)
//   • Refined row layout — status pill, cron expression, suite, schedule times
//   • Form rendered in a Card when open (and an empty `hidden` form when
//     closed so Cypress's `not.be.visible` queries still resolve)
//   • History modal (Escape-to-close preserved)
//   • ConfirmModal for destructive deletes
//
// Every existing `data-cy` hook is preserved verbatim so the Cypress UI
// suite keeps passing without changes.
// =============================================================================

import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { ConfirmModal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/hooks/useAuth';
import { showToast } from '@/lib/toast';

import { useSuites } from '@/features/suites/hooks';

import type { ScheduledJob, ScheduledJobCreateInput } from './api';
import {
  useCreateJob,
  useDeleteJob,
  useJobHistory,
  useJobs,
  useRunJob,
  useUpdateJob,
} from './hooks';

interface FormState {
  name: string;
  cron: string;
  timezone: string;
  suite_id: number;
  max_retries: number;
}

const EMPTY_FORM: FormState = {
  name: '',
  cron: '',
  timezone: 'UTC',
  suite_id: 0,
  max_retries: 0,
};

type PendingDelete = ScheduledJob | null;

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
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete>(null);

  // History modal: the id of the job whose history we're showing.
  // null = closed. We gate the query with `enabled`.
  const [historyJobId, setHistoryJobId] = useState<number | null>(null);
  const historyQ = useJobHistory(historyJobId ?? 0, historyJobId !== null);

  const jobs = jobsQ.data ?? [];
  const suites = suitesQ.data ?? [];

  const openCreate = () => {
    setEditingId(null);
    setForm({
      ...EMPTY_FORM,
      suite_id: suites[0]?.id ?? 0,
    });
    setFormOpen(true);
  };

  const closeForm = () => {
    setFormOpen(false);
    setEditingId(null);
    setForm(EMPTY_FORM);
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
      <PageHeader
        eyebrow="Automation"
        title="Scheduler"
        description="Cron-based triggers that run a test suite on a schedule."
        actions={
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
        }
      />

      <Card className="overflow-hidden">
        <details data-cy="cron-help" className="group">
          <summary className="flex cursor-pointer items-center justify-between gap-2 px-4 py-3 text-sm font-medium text-text transition-colors hover:bg-surface-hover [&::-webkit-details-marker]:hidden list-none">
            <span className="flex items-center gap-2">
              <Icon.Schedule size={14} className="text-text-tertiary" />
              Cron syntax quick reference
            </span>
            <span className="text-text-tertiary transition-transform group-open:rotate-90">
              <Icon.Chevron size={14} />
            </span>
          </summary>
          <div className="border-t border-border-soft px-4 py-3 text-sm text-text-secondary">
            <p className="mb-2">
              Five space-separated fields:{' '}
              <code className="rounded bg-surface-sunken px-1 py-0.5 font-mono text-xs text-text">
                minute hour day-of-month month day-of-week
              </code>
              {' '}— all in UTC; day-of-week: 0 = Sunday.
            </p>
            <table className="mt-2 w-full text-xs">
              <thead>
                <tr className="text-left text-text-tertiary">
                  <th className="py-1 font-medium">Expression</th>
                  <th className="py-1 font-medium">Meaning</th>
                </tr>
              </thead>
              <tbody className="text-text-secondary">
                <tr><td><code className="font-mono">* * * * *</code></td><td>Every minute</td></tr>
                <tr><td><code className="font-mono">0 9 * * *</code></td><td>Every day at 09:00 UTC</td></tr>
                <tr><td><code className="font-mono">0 9 * * 1-5</code></td><td>Weekdays at 09:00 UTC</td></tr>
                <tr><td><code className="font-mono">*/15 * * * *</code></td><td>Every 15 minutes</td></tr>
                <tr><td><code className="font-mono">30 14 * * 1</code></td><td>Mondays at 14:30 UTC</td></tr>
                <tr><td><code className="font-mono">*/5 9-17 * * *</code></td><td>Every 5 min, between 9am and 5pm</td></tr>
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <Card className="overflow-hidden">
        {jobs.length === 0 ? (
          <div data-cy="job-list">
            <div data-cy="empty-no-jobs" className="px-3 py-2">
              <EmptyState
                icon={<Icon.Schedule size={20} />}
                title="No scheduled jobs yet"
                description="Create a scheduled job to run a test suite automatically on a cron schedule."
                action={
                  isAdmin ? (
                    <Button
                      variant="primary"
                      data-cy="empty-new-job-btn"
                      data-admin-only
                      leftIcon={<Icon.Plus size={14} />}
                      onClick={openCreate}
                    >
                      New scheduled job
                    </Button>
                  ) : undefined
                }
              />
            </div>
          </div>
        ) : (
          <ul data-cy="job-list" className="divide-y divide-border-soft">
            {jobs.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                isAdmin={isAdmin}
                onRun={() => onRun(job)}
                onToggle={() => onToggle(job)}
                onDelete={() => setPendingDelete(job)}
                onHistory={() => setHistoryJobId(job.id)}
              />
            ))}
          </ul>
        )}
      </Card>

      {formOpen && (
        <JobForm
          form={form}
          setForm={setForm}
          suites={suites}
          isEdit={editingId !== null}
          onSubmit={submitForm}
          onCancel={closeForm}
          isSubmitting={createM.isPending || updateM.isPending}
        />
      )}

      {/* Always-rendered form so Cypress's `not.be.visible` after submit
          can find it (the vanilla page kept the form in the DOM and just
          toggled the `hidden` attribute). */}
      {!formOpen && (
        <form
          data-cy="job-form"
          hidden
          onSubmit={(e) => e.preventDefault()}
          className="hidden"
        />
      )}

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
        <HistoryModal
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

interface JobRowProps {
  job: ScheduledJob;
  isAdmin: boolean;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onHistory: () => void;
}

function JobRow({ job, isAdmin, onRun, onToggle, onDelete, onHistory }: JobRowProps) {
  const statusBadge = job.last_error ? (
    <span data-cy="job-status-error" title={job.last_error}>
      <Pill tone="danger" size="sm">
        <span className="inline-flex items-center gap-1">
          <Icon.Warning size={10} />
          error
        </span>
      </Pill>
    </span>
  ) : job.enabled ? (
    <span data-cy="job-status-enabled">
      <Pill tone="success" size="sm">
        <span className="inline-flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-success" />
          enabled
        </span>
      </Pill>
    </span>
  ) : (
    <span data-cy="job-status-disabled">
      <Pill tone="neutral" size="sm">disabled</Pill>
    </span>
  );

  const suiteName = job.suite?.name ?? `suite #${job.suite_id}`;
  const retryBadge =
    (job.retry_count ?? 0) > 0 ? (
      <span data-cy="job-retry-badge">
        <Pill tone="warning" size="sm">
          retry {job.retry_count}/{job.max_retries}
        </Pill>
      </span>
    ) : null;

  return (
    <li
      data-cy="job-row"
      data-job-id={job.id}
      className={`px-4 py-3.5 transition-colors hover:bg-surface-hover ${!job.enabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong data-cy="job-name" className="text-sm font-semibold text-text">
              {job.name}
            </strong>
            {retryBadge}
            {statusBadge}
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-text-secondary">
            <code
              data-cy="job-cron"
              title={humanizeCron(job.cron)}
              className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-text"
            >
              {job.cron}
            </code>
            <span className="text-text-tertiary">→</span>
            <span data-cy="job-suite-name" className="inline-flex items-center gap-1">
              <Icon.Suites size={12} className="text-text-tertiary" />
              {suiteName}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <span className="text-text-tertiary">next</span>
              <span data-cy="job-next-run" title={absoluteTime(job.next_run_at)} className="font-medium text-text">
                {job.next_run_at ? relativeTime(job.next_run_at) : '—'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-text-tertiary">last</span>
              <span data-cy="job-last-run" title={absoluteTime(job.last_run_at)} className="font-medium text-text">
                {job.last_run_at ? relativeTime(job.last_run_at) : 'never'}
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            data-cy="job-run-btn"
            data-admin-only
            hidden={!isAdmin}
            leftIcon={<Icon.Run size={12} />}
            onClick={onRun}
          >
            Run now
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-cy="job-toggle-btn"
            data-admin-only
            hidden={!isAdmin}
            leftIcon={job.enabled ? <Icon.Pause size={12} /> : <Icon.Run size={12} />}
            onClick={onToggle}
          >
            {job.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-cy="job-history-btn"
            leftIcon={<Icon.History size={12} />}
            onClick={onHistory}
          >
            History
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-cy="job-delete-btn"
            data-admin-only
            hidden={!isAdmin}
            leftIcon={<Icon.Trash size={12} />}
            onClick={onDelete}
            className="!text-danger-text hover:!bg-danger-soft"
          >
            Delete
          </Button>
        </div>
      </div>
    </li>
  );
}

interface JobFormProps {
  form: FormState;
  setForm: React.Dispatch<React.SetStateAction<FormState>>;
  suites: { id: number; name: string }[];
  isEdit: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

function JobForm({ form, setForm, suites, isEdit, onSubmit, onCancel, isSubmitting }: JobFormProps) {
  const valid = isValidCronClient(form.cron);
  const previewText = form.cron.trim()
    ? valid
      ? `✓ ${humanizeCron(form.cron)}`
      : '✗ Not a valid 5-field cron expression'
    : '';

  return (
    <Card className="p-5">
      <form
        data-cy="job-form"
        onSubmit={onSubmit}
        className="space-y-3"
      >
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand">
            <Icon.Schedule size={14} />
          </span>
          <h3 className="text-base font-semibold text-text">
            {isEdit ? 'Edit Scheduled Job' : 'New Scheduled Job'}
          </h3>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Name</span>
            <input
              name="name"
              data-cy="job-name-input"
              placeholder="e.g. Weekday smoke"
              required
              maxLength={120}
              value={form.name}
              onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              className="rg-input mt-1"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Test suite</span>
            <select
              name="suite_id"
              data-cy="job-suite-select"
              required
              value={form.suite_id}
              onChange={(e) => setForm((f) => ({ ...f, suite_id: Number(e.target.value) }))}
              className="rg-input mt-1"
            >
              <option value={0} disabled>
                {suites.length ? 'Select a suite…' : '(no suites exist yet)'}
              </option>
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Cron expression</span>
            <input
              name="cron"
              data-cy="job-cron-input"
              placeholder="0 9 * * 1-5"
              required
              value={form.cron}
              onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
              className="rg-input mt-1 font-mono"
            />
          </label>

          <label className="block">
            <span className="text-xs font-medium text-text-secondary">Timezone (display only; cron fields are UTC)</span>
            <input
              name="timezone"
              data-cy="job-timezone-input"
              value={form.timezone}
              maxLength={60}
              onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
              className="rg-input mt-1"
            />
          </label>

          <label className="block md:col-span-2 md:max-w-xs">
            <span className="text-xs font-medium text-text-secondary">Max retries on failure</span>
            <input
              name="max_retries"
              data-cy="job-retries-input"
              type="number"
              min={0}
              max={10}
              value={form.max_retries}
              onChange={(e) => setForm((f) => ({ ...f, max_retries: Number(e.target.value) }))}
              className="rg-input mt-1"
            />
          </label>
        </div>

        <div
          data-cy="job-form-preview"
          hidden={!form.cron.trim()}
          className={`rounded-lg border px-3 py-2 text-xs ${
            valid
              ? 'border-success-border bg-success-soft text-success-text'
              : 'border-danger-border bg-danger-soft text-danger-text'
          }`}
        >
          {previewText}
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-cy="job-cancel-btn"
            onClick={onCancel}
            leftIcon={<Icon.X size={12} />}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            data-cy="job-submit-btn"
            disabled={isSubmitting || !valid || !form.name.trim() || !form.suite_id}
            loading={isSubmitting}
          >
            {isEdit ? 'Update' : 'Create'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

interface HistoryModalProps {
  job: ScheduledJob | null;
  events: { created_at: string; actor_id?: number | null; ip?: string | null }[];
  count: number;
  isLoading: boolean;
  onClose: () => void;
}

function HistoryModal({ job, events, count, isLoading, onClose }: HistoryModalProps) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      data-cy="history-modal"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg overflow-hidden rounded-xl border border-border bg-surface"
        style={{ boxShadow: 'var(--shadow-pop)' }}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-soft px-5 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Icon.History size={14} />
            </span>
            <h3 className="text-base font-semibold text-text">
              History &mdash; &quot;{job?.name ?? ''}&quot;
            </h3>
          </div>
        </div>
        <div className="px-5 py-4">
          <p className="mb-3 text-xs text-text-secondary">
            {isLoading
              ? 'Loading…'
              : `Last ${count} fire(s). Manual + scheduled runs are recorded here.`}
          </p>
          {count > 0 ? (
            <table data-cy="history-table" className="mb-1 w-full border-collapse text-xs">
              <thead>
                <tr className="border-b border-border text-left text-text-tertiary">
                  <th className="py-1.5 font-medium">When</th>
                  <th className="py-1.5 font-medium">Trigger</th>
                  <th className="py-1.5 font-medium">IP</th>
                </tr>
              </thead>
              <tbody>
                {events.map((e, i) => (
                  <tr key={i} className="border-b border-border-soft last:border-0">
                    <td className="py-1.5 text-text">{absoluteTime(e.created_at)}</td>
                    <td className="py-1.5 text-text-secondary">
                      {e.actor_id ? `user #${e.actor_id}` : 'system'}
                    </td>
                    <td className="py-1.5 font-mono text-text-tertiary">{e.ip ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : !isLoading ? (
            <p data-cy="history-empty" className="mb-1 text-sm text-text-secondary">
              No runs recorded yet.
            </p>
          ) : null}
        </div>
        <div className="flex justify-end border-t border-border-soft bg-bg px-5 py-3">
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-cy="history-close-btn"
            onClick={onClose}
          >
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}

// ----- Format helpers (same logic as the vanilla scheduler.js) -----

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  const now = Date.now();
  const diffMs = then - now;
  const absMs = Math.abs(diffMs);
  const past = diffMs < 0;
  const units: [number, string, number][] = [
    [60_000, 'sec', 1000],
    [60, 'min', 60_000],
    [24, 'hr', 60 * 60_000],
    [30, 'day', 24 * 60 * 60_000],
    [12, 'month', 30 * 24 * 60 * 60_000],
  ];
  let v = absMs;
  let label: string = 'sec';
  for (const [boundary, unit, msPerUnit] of units) {
    if (v < boundary) {
      label = unit;
      break;
    }
    v = v / msPerUnit;
    label = unit;
  }
  const n = Math.round(v);
  return past ? `${n} ${label} ago` : `in ${n} ${label}`;
}

function absoluteTime(iso?: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString();
}

function humanizeCron(expr: string): string {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const m = parts[0] ?? '';
  const h = parts[1] ?? '';
  const dom = parts[2] ?? '';
  const mo = parts[3] ?? '';
  const dow = parts[4] ?? '';
  const isWild = (s: string | undefined) => s === '*';
  const dowName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const h12 = (hh: string) => {
    const n = parseInt(hh, 10);
    if (!Number.isFinite(n)) return hh;
    if (n === 0) return '12am';
    if (n === 12) return '12pm';
    return n < 12 ? `${n}am` : `${n - 12}pm`;
  };
  const min12 = (mm: string, hh: string) => `${hh}:${String(mm).padStart(2, '0')}`;

  if (/^\*\/\d+$/.test(m) && isWild(h) && isWild(dom) && isWild(mo) && isWild(dow)) {
    return `Every ${parseInt(m.slice(2), 10)} minutes`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && isWild(dom) && isWild(mo) && /^1-5$/.test(dow)) {
    return `Weekdays at ${h12(h)}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && isWild(dom) && isWild(mo) && isWild(dow)) {
    return `Every day at ${h12(h)}`;
  }
  if (/^\d+$/.test(m) && /^\d+$/.test(h) && isWild(dom) && isWild(mo) && /^\d+$/.test(dow)) {
    const dowIdx = parseInt(dow, 10);
    const dowLabel = dowName[dowIdx] ?? `day ${dow}`;
    return `${dowLabel} at ${min12(m, h12(h))}`;
  }
  if (isWild(m) && isWild(h) && isWild(dom) && isWild(mo) && isWild(dow)) return 'Every minute';
  return expr;
}

function isValidCronClient(expr: string): boolean {
  const parts = String(expr || '').trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const ranges: [number, number][] = [
    [0, 59],
    [0, 23],
    [1, 31],
    [1, 12],
    [0, 6],
  ];
  return parts.every((p, i) => {
    const range = ranges[i];
    if (!range) return false;
    const [lo, hi] = range;
    for (const tok of p.split(',')) {
      const slashIdx = tok.indexOf('/');
      const base = slashIdx >= 0 ? tok.slice(0, slashIdx) : tok;
      const stepStr = slashIdx >= 0 ? tok.slice(slashIdx + 1) : undefined;
      const stepNum = stepStr === undefined ? 1 : parseInt(stepStr, 10);
      if (!Number.isFinite(stepNum) || stepNum <= 0) return false;
      let from: number;
      let to: number;
      if (base === '*') {
        from = lo;
        to = hi;
      } else if (base.includes('-')) {
        const [a, b] = base.split('-');
        from = parseInt(a ?? '', 10);
        to = parseInt(b ?? '', 10);
      } else {
        from = parseInt(base, 10);
        to = from;
      }
      if (!Number.isFinite(from) || !Number.isFinite(to)) return false;
      if (from < lo || to > hi || from > to) return false;
    }
    return true;
  });
}