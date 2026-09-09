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
// Cron input is wrapped in plain-English preset chips so most users never
// have to type raw cron. They click "Weekdays at 9am" and the field fills
// in `0 9 * * 1-5` for them. Power users can still type a custom value.
//
// Every existing data-cy hook is preserved so the Cypress UI suite keeps
// passing without changes.
// =============================================================================

import { useEffect, useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { ConfirmModal } from '@/components/Modal';
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

// ---- Schedule presets ----------------------------------------------------
// Plain English labels → cron expressions. Shown as clickable chips
// above the cron input. The "Custom" entry clears the field so users
// who know cron can type their own.

interface Preset {
  label: string;
  cron: string;
}

const PRESETS: Preset[] = [
  { label: 'Every 15 minutes', cron: '*/15 * * * *' },
  { label: 'Every hour', cron: '0 * * * *' },
  { label: 'Every day at midnight', cron: '0 0 * * *' },
  { label: 'Every day at 9am', cron: '0 9 * * *' },
  { label: 'Weekdays at 9am', cron: '0 9 * * 1-5' },
  { label: 'Mondays at 9am', cron: '0 9 * * 1' },
];

// ---- Component -----------------------------------------------------------

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
  const [pendingDelete, setPendingDelete] = useState<ScheduledJob | null>(null);
  const [historyJobId, setHistoryJobId] = useState<number | null>(null);
  const historyQ = useJobHistory(historyJobId ?? 0, historyJobId !== null);

  const jobs = jobsQ.data ?? [];
  const suites = suitesQ.data ?? [];

  const openCreate = () => {
    setEditingId(null);
    setForm({ ...EMPTY_FORM, suite_id: suites[0]?.id ?? 0 });
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

// ---- Job row -------------------------------------------------------------

interface JobRowProps {
  job: ScheduledJob;
  isAdmin: boolean;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onHistory: () => void;
}

function JobRow({ job, isAdmin, onRun, onToggle, onDelete, onEdit, onHistory }: JobRowProps) {
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
          on
        </span>
      </Pill>
    </span>
  ) : (
    <span data-cy="job-status-disabled">
      <Pill tone="neutral" size="sm">off</Pill>
    </span>
  );

  const suiteName = job.suite?.name ?? `suite #${job.suite_id}`;
  const summary = humanizeCron(job.cron);
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
          {/* Plain English summary first, raw cron below for power users */}
          <div className="mt-1.5 text-sm text-text">{summary}</div>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-text-secondary">
            <code
              data-cy="job-cron"
              className="rounded bg-surface-sunken px-1.5 py-0.5 font-mono text-[11px] text-text-tertiary"
            >
              {job.cron}
            </code>
            <span className="text-text-tertiary">·</span>
            <span data-cy="job-suite-name" className="inline-flex items-center gap-1">
              <Icon.Suites size={12} className="text-text-tertiary" />
              {suiteName}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-4 text-xs text-text-secondary">
            <span className="inline-flex items-center gap-1.5">
              <span className="text-text-tertiary">Next</span>
              <span data-cy="job-next-run" title={absoluteTime(job.next_run_at)} className="font-medium text-text">
                {job.next_run_at ? relativeTime(job.next_run_at) : '—'}
              </span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className="text-text-tertiary">Last</span>
              <span data-cy="job-last-run" title={absoluteTime(job.last_run_at)} className="font-medium text-text">
                {job.last_run_at ? relativeTime(job.last_run_at) : 'never'}
              </span>
            </span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
          <Button
            type="button"
            variant="primary"
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
            data-cy="job-toggle-btn"
            data-admin-only
            hidden={!isAdmin}
            onClick={onToggle}
          >
            {job.enabled ? 'Disable' : 'Enable'}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-cy="job-edit-btn"
            data-admin-only
            hidden={!isAdmin}
            onClick={onEdit}
          >
            <Icon.Edit size={14} />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            data-cy="job-delete-btn"
            data-admin-only
            hidden={!isAdmin}
            onClick={onDelete}
            className="!text-danger-text hover:!bg-danger-soft"
            aria-label="Delete"
          >
            <Icon.Trash size={14} />
          </Button>
        </div>
      </div>
    </li>
  );
}

// ---- Create / edit form --------------------------------------------------

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
  const cronText = form.cron.trim();
  const previewText = cronText
    ? valid
      ? `Runs ${humanizeCron(form.cron)}`
      : 'Not a valid 5-field cron expression'
    : 'Pick a preset above or type your own cron expression.';

  return (
    <Card>
      <form data-cy="job-form" onSubmit={onSubmit} className="p-5 space-y-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-soft text-brand">
              <Icon.Schedule size={16} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-text">
                {isEdit ? 'Edit schedule' : 'New schedule'}
              </h3>
              <p className="text-xs text-text-tertiary">
                Runs the chosen suite on this cron expression.
              </p>
            </div>
          </div>
        </div>

        {/* Name + Suite — the two most important fields, front and center */}
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
            <span className="text-xs font-medium text-text-secondary">Suite to run</span>
            <select
              name="suite_id"
              data-cy="job-suite-select"
              required
              value={form.suite_id}
              onChange={(e) => setForm((f) => ({ ...f, suite_id: Number(e.target.value) }))}
              className="rg-input mt-1"
            >
              <option value={0} disabled>
                {suites.length ? 'Select a suite…' : '(create a suite first)'}
              </option>
              {suites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Schedule — preset chips + cron input + plain-English preview */}
        <div>
          <span className="text-xs font-medium text-text-secondary">When to run</span>

          {/* Preset chips — click one to fill the cron field */}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {PRESETS.map((p) => {
              const active = cronText === p.cron;
              return (
                <button
                  key={p.cron}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, cron: p.cron }))}
                  className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? 'border-brand bg-brand-soft text-brand-hover'
                      : 'border-border bg-surface text-text-secondary hover:border-brand/40 hover:bg-surface-hover'
                  }`}
                >
                  {p.label}
                </button>
              );
            })}
          </div>

          {/* Cron input — visible for power users + tests. Auto-fills when a
              preset is clicked. */}
          <input
            name="cron"
            data-cy="job-cron-input"
            placeholder="0 9 * * 1-5"
            value={form.cron}
            onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
            className="rg-input mt-2 font-mono text-sm"
            spellCheck={false}
            autoComplete="off"
          />

          {/* Plain-English preview of what the cron means */}
          <div
            data-cy="job-form-preview"
            className={`mt-2 rounded-md border px-3 py-2 text-xs ${
              !cronText
                ? 'border-border bg-surface-sunken text-text-tertiary'
                : valid
                  ? 'border-success-border bg-success-soft text-success-text'
                  : 'border-danger-border bg-danger-soft text-danger-text'
            }`}
          >
            {previewText}
          </div>
        </div>

        {/* Advanced — collapsed by default. Most users never touch these. */}
        <details className="rounded-md border border-border-soft bg-surface-sunken/40 px-3 py-2">
          <summary className="cursor-pointer text-xs font-medium text-text-secondary [&::-webkit-details-marker]:hidden list-none">
            Advanced settings
          </summary>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="block">
              <span className="text-xs font-medium text-text-secondary">Timezone label (display only)</span>
              <input
                name="timezone"
                data-cy="job-timezone-input"
                value={form.timezone}
                maxLength={60}
                onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
                className="rg-input mt-1"
                placeholder="UTC"
              />
            </label>

            <label className="block">
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
              <p className="mt-1 text-[11px] text-text-tertiary">
                0 = first failure is final. Higher values retry with exponential backoff.
              </p>
            </label>
          </div>
        </details>

        <div className="flex justify-end gap-2 pt-1 border-t border-border-soft">
          <Button
            type="button"
            variant="secondary"
            data-cy="job-cancel-btn"
            onClick={onCancel}
          >
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            data-cy="job-submit-btn"
            disabled={isSubmitting || !valid || !form.name.trim() || !form.suite_id}
            loading={isSubmitting}
          >
            {isEdit ? 'Save changes' : 'Create schedule'}
          </Button>
        </div>
      </form>
    </Card>
  );
}

// ---- History modal -------------------------------------------------------

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
              Run history &mdash; &quot;{job?.name ?? ''}&quot;
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

// ----- Format helpers -----

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
