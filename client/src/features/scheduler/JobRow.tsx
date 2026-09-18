// JobRow — one scheduled job, render-only.
//
// All callbacks are passed in (parent owns the data + mutations). This
// keeps the row dumb and trivially storybook-able. Every data-cy hook
// here is preserved verbatim from the pre-split SchedulerPage so the
// Cypress scheduler UI suite passes without modification.

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icons';
import { Pill } from '@/components/Pill';

import type { ScheduledJob } from './api';
import { absoluteTime, humanizeCron, relativeTime } from './cronUtils';

interface JobRowProps {
  job: ScheduledJob;
  isAdmin: boolean;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
  onEdit: () => void;
  onHistory: () => void;
}

export function JobRow({
  job,
  isAdmin,
  onRun,
  onToggle,
  onDelete,
  onEdit,
  onHistory,
}: JobRowProps) {
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
