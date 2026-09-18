// HistoryDrawer — slide-in modal showing recent run-history audit events
// for one scheduled job. Click backdrop / press Escape to close.
//
// Renamed from HistoryModal during the SchedulerPage split (PR-Q) to
// match the visual reality: the panel overlays the page like a
// right-side drawer rather than sitting in the centre as a dialog.
// data-cy="history-modal" is preserved so existing Cypress selectors
// keep working.

import { useEffect } from 'react';

import { Button } from '@/components/Button';
import { Icon } from '@/components/Icons';

import type { HistoryEvent, ScheduledJob } from './api';
import { absoluteTime } from './cronUtils';

interface HistoryDrawerProps {
  job: ScheduledJob | null;
  events: HistoryEvent[];
  count: number;
  isLoading: boolean;
  onClose: () => void;
}

export function HistoryDrawer({ job, events, count, isLoading, onClose }: HistoryDrawerProps) {
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
