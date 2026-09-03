// The Scheduler page (/scheduler).
//
// Mirrors public/scheduler.html UX. Lists scheduled jobs with per-row
// admin actions (run now, toggle, delete) plus a viewer-visible History
// button that opens a modal. Inline create/edit form with a live cron
// preview as the user types.

import { useEffect, useState } from 'react';

import { ConfirmModal } from '@/components/Modal';
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
    <section>
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold">Scheduler</h2>
          <p className="text-sm text-gray-500">Cron-based triggers that run a test suite on a schedule.</p>
        </div>
        <button
          type="button"
          data-cy="job-new-btn"
          data-admin-only
          hidden={!isAdmin}
          onClick={openCreate}
          className="rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
        >
          + New Scheduled Job
        </button>
      </div>

      <details data-cy="cron-help" className="mb-4 rounded border border-gray-200 bg-white p-3 text-sm">
        <summary className="cursor-pointer font-medium">Cron syntax quick reference</summary>
        <div className="mt-2 space-y-1 text-gray-700">
          <p>
            Five space-separated fields:{' '}
            <code className="rounded bg-gray-100 px-1">minute hour day-of-month month day-of-week</code>
            (all in UTC; day-of-week: 0 = Sunday).
          </p>
          <table className="mt-2 w-full text-xs">
            <thead>
              <tr className="text-left text-gray-500">
                <th className="py-1">Expression</th>
                <th className="py-1">Meaning</th>
              </tr>
            </thead>
            <tbody>
              <tr><td><code>* * * * *</code></td><td>Every minute</td></tr>
              <tr><td><code>0 9 * * *</code></td><td>Every day at 09:00 UTC</td></tr>
              <tr><td><code>0 9 * * 1-5</code></td><td>Weekdays at 09:00 UTC</td></tr>
              <tr><td><code>*/15 * * * *</code></td><td>Every 15 minutes</td></tr>
              <tr><td><code>30 14 * * 1</code></td><td>Mondays at 14:30 UTC</td></tr>
              <tr><td><code>*/5 9-17 * * *</code></td><td>Every 5 min, between 9am and 5pm</td></tr>
            </tbody>
          </table>
        </div>
      </details>

      <ul
        data-cy="job-list"
        className="divide-y divide-gray-100 rounded border border-gray-200 bg-white"
      >
        {jobs.length === 0 ? (
          <li data-cy="empty-no-jobs" className="px-3 py-6 text-center text-sm text-gray-500">
            No scheduled jobs yet. Click &quot;+ New Scheduled Job&quot; to create one.
          </li>
        ) : (
          jobs.map((job) => (
            <JobRow
              key={job.id}
              job={job}
              isAdmin={isAdmin}
              onRun={() => onRun(job)}
              onToggle={() => onToggle(job)}
              onDelete={() => setPendingDelete(job)}
              onHistory={() => setHistoryJobId(job.id)}
            />
          ))
        )}
      </ul>

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
          className="rounded border border-gray-200 bg-white p-3"
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
    <span
      data-cy="job-status-error"
      title={job.last_error}
      className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-700"
    >
      error
    </span>
  ) : job.enabled ? (
    <span
      data-cy="job-status-enabled"
      className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium text-green-700"
    >
      enabled
    </span>
  ) : (
    <span
      data-cy="job-status-disabled"
      className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
    >
      disabled
    </span>
  );

  const suiteName = job.suite?.name ?? `suite #${job.suite_id}`;
  const retryBadge =
    (job.retry_count ?? 0) > 0 ? (
      <span
        data-cy="job-retry-badge"
        className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700"
      >
        retry {job.retry_count}/{job.max_retries}
      </span>
    ) : null;

  return (
    <li
      data-cy="job-row"
      data-job-id={job.id}
      className={`p-3 ${!job.enabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <strong data-cy="job-name" className="text-sm">
              {job.name}
            </strong>
            {retryBadge}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-700">
            <code data-cy="job-cron" title={humanizeCron(job.cron)} className="rounded bg-gray-100 px-1">
              {job.cron}
            </code>
            <span className="text-gray-400">→</span>
            <span data-cy="job-suite-name">{suiteName}</span>
            {statusBadge}
          </div>
          <div className="mt-1 flex flex-wrap gap-3 text-xs text-gray-600">
            <span>
              <span className="text-gray-400">next</span>{' '}
              <span data-cy="job-next-run" title={absoluteTime(job.next_run_at)}>
                {job.next_run_at ? relativeTime(job.next_run_at) : '—'}
              </span>
            </span>
            <span>
              <span className="text-gray-400">last</span>{' '}
              <span data-cy="job-last-run" title={absoluteTime(job.last_run_at)}>
                {job.last_run_at ? relativeTime(job.last_run_at) : 'never'}
              </span>
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            data-cy="job-run-btn"
            data-admin-only
            hidden={!isAdmin}
            onClick={onRun}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
          >
            Run now
          </button>
          <button
            type="button"
            data-cy="job-toggle-btn"
            data-admin-only
            hidden={!isAdmin}
            onClick={onToggle}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
          >
            {job.enabled ? 'Disable' : 'Enable'}
          </button>
          <button
            type="button"
            data-cy="job-history-btn"
            onClick={onHistory}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
          >
            History
          </button>
          <button
            type="button"
            data-cy="job-delete-btn"
            data-admin-only
            hidden={!isAdmin}
            onClick={onDelete}
            className="rounded border border-gray-300 px-2 py-0.5 text-xs hover:bg-gray-50"
          >
            Delete
          </button>
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
    <form
      data-cy="job-form"
      onSubmit={onSubmit}
      className="mt-4 space-y-2 rounded border border-gray-200 bg-white p-3"
    >
      <h3 className="text-sm font-semibold">
        {isEdit ? 'Edit Scheduled Job' : 'New Scheduled Job'}
      </h3>
      <label className="block text-xs text-gray-700">
        Name
        <input
          name="name"
          data-cy="job-name-input"
          placeholder="e.g. Weekday smoke"
          required
          maxLength={120}
          value={form.name}
          onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="block text-xs text-gray-700">
        Cron expression
        <input
          name="cron"
          data-cy="job-cron-input"
          placeholder="0 9 * * 1-5"
          required
          value={form.cron}
          onChange={(e) => setForm((f) => ({ ...f, cron: e.target.value }))}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <div
        data-cy="job-form-preview"
        hidden={!form.cron.trim()}
        className={`rounded px-2 py-1 text-xs ${valid ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}
      >
        {previewText}
      </div>
      <label className="block text-xs text-gray-700">
        Timezone (display only; cron fields are UTC)
        <input
          name="timezone"
          data-cy="job-timezone-input"
          value={form.timezone}
          maxLength={60}
          onChange={(e) => setForm((f) => ({ ...f, timezone: e.target.value }))}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <label className="block text-xs text-gray-700">
        Test suite
        <select
          name="suite_id"
          data-cy="job-suite-select"
          required
          value={form.suite_id}
          onChange={(e) => setForm((f) => ({ ...f, suite_id: Number(e.target.value) }))}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
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
      <label className="block text-xs text-gray-700">
        Max retries on failure
        <input
          name="max_retries"
          data-cy="job-retries-input"
          type="number"
          min={0}
          max={10}
          value={form.max_retries}
          onChange={(e) => setForm((f) => ({ ...f, max_retries: Number(e.target.value) }))}
          className="mt-1 block w-full rounded border border-gray-300 px-2 py-1 text-sm"
        />
      </label>
      <div className="flex justify-end gap-2">
        <button
          type="submit"
          data-cy="job-submit-btn"
          disabled={isSubmitting || !valid || !form.name.trim() || !form.suite_id}
          className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {isEdit ? 'Update' : 'Create'}
        </button>
        <button
          type="button"
          data-cy="job-cancel-btn"
          onClick={onCancel}
          className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
        >
          Cancel
        </button>
      </div>
    </form>
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
        className="w-full max-w-lg rounded bg-white p-5 shadow-xl"
      >
        <h3 className="mb-2 text-base font-semibold">History — &quot;{job?.name ?? ''}&quot;</h3>
        <p className="mb-3 text-xs text-gray-500">
          {isLoading ? 'Loading…' : `Last ${count} fire(s). Manual + scheduled runs are recorded here.`}
        </p>
        {count > 0 ? (
          <table data-cy="history-table" className="mb-3 w-full border-collapse text-xs">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="py-1">When</th>
                <th className="py-1">Trigger</th>
                <th className="py-1">IP</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-1">{absoluteTime(e.created_at)}</td>
                  <td className="py-1">{e.actor_id ? `user #${e.actor_id}` : 'system'}</td>
                  <td className="py-1">{e.ip ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : !isLoading ? (
          <p data-cy="history-empty" className="mb-3 text-sm text-gray-500">
            No runs recorded yet.
          </p>
        ) : null}
        <div className="flex justify-end">
          <button
            type="button"
            data-cy="history-close-btn"
            onClick={onClose}
            className="rounded bg-blue-600 px-3 py-1 text-sm font-medium text-white hover:bg-blue-700"
          >
            Close
          </button>
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
