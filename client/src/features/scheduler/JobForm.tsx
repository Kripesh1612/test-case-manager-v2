// JobForm — create / edit a scheduled job.
//
// Form state is owned by the parent (SchedulerPage) so the same draft
// survives a quick edit-cancel-reopen without re-mounting this component.
// We only render; the parent's submitForm runs the create / update
// mutation and closes the panel.
//
// Preset chips cover the common cases; the cron input stays editable so
// power users can type any 5-field expression. The preview block shows
// either humanized output, the raw "not valid" warning, or a hint to
// pick a preset — colour-coded to match the input's validity.

import type { Dispatch, SetStateAction } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Icon } from '@/components/Icons';

import { humanizeCron, isValidCronClient } from './cronUtils';

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

export interface JobFormState {
  name: string;
  cron: string;
  timezone: string;
  suite_id: number;
  max_retries: number;
}

export const EMPTY_JOB_FORM: JobFormState = {
  name: '',
  cron: '',
  timezone: 'UTC',
  suite_id: 0,
  max_retries: 0,
};

interface JobFormProps {
  form: JobFormState;
  setForm: Dispatch<SetStateAction<JobFormState>>;
  suites: { id: number; name: string }[];
  isEdit: boolean;
  onSubmit: (e: React.FormEvent) => void;
  onCancel: () => void;
  isSubmitting: boolean;
}

export function JobForm({
  form,
  setForm,
  suites,
  isEdit,
  onSubmit,
  onCancel,
  isSubmitting,
}: JobFormProps) {
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
