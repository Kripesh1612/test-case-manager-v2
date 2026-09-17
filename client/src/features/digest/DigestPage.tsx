// =============================================================================
// /admin/digest — admin-only email digest management (Feature 2).
//
// Layout:
//   1. Page header: explains the feature + "Send now" + "Preview" buttons.
//   2. Preview card — the last composed digest (title, recipients, sections).
//   3. History table — one row per digest_logs entry with window + recipients.
//
// data-cy contract (this page owns the digest feature, mirroring webhooks):
//   digest-new-btn / digest-preview-btn / digest-invalidate-btn
//   digest-preview-card / digest-preview-title / digest-preview-recipients
//   digest-section-row / digest-section-label / digest-section-count
//   digest-table / digest-row / digest-sent-at / digest-recipients
//   digest-empty
// =============================================================================

import { useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { PageHeader } from '@/components/PageHeader';
import { showToast } from '@/lib/toast';

import { useDigestHistory, useDigestPreview, useSendDigest } from './hooks';
import type { DigestSection } from './api';

export function DigestPage() {
  const history = useDigestHistory();
  const preview = useDigestPreview();
  const sendM = useSendDigest();

  const [showPreview, setShowPreview] = useState(false);

  const logs = history.data ?? [];
  const previewData = showPreview ? preview.data : null;

  async function sendNow() {
    try {
      const res = await sendM.mutateAsync();
      showToast({
        message: res.delivery?.delivered
          ? `Digest delivered to ${res.recipients.length} recipient(s)`
          : 'Digest composed and logged',
        variant: 'success',
      });
      setShowPreview(false);
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      showToast({ message: msg ?? 'Failed to send digest', variant: 'error' });
    }
  }

  function togglePreview() {
    if (!showPreview && !preview.isFetched) preview.refetch();
    setShowPreview((v) => !v);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Notifications"
        title="Daily digest"
        description="Periodic summary of project activity: new cases, updated cases, and run outcomes. The digest is emailed to configured recipients on schedule."
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-text-secondary">
            Digests follow the DIGEST_SCHEDULE cron (default 08:00 UTC, opt-in via DIGEST_ENABLED=1).
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              data-cy="digest-preview-btn"
              leftIcon={<Icon.Mail size={14} />}
              onClick={togglePreview}
              loading={preview.isFetching}
            >
              {showPreview ? 'Hide preview' : 'Preview'}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              data-cy="digest-new-btn"
              leftIcon={<Icon.Send size={14} />}
              onClick={sendNow}
              loading={sendM.isPending}
            >
              {sendM.isPending ? 'Sending…' : 'Send now'}
            </Button>
          </div>
        </div>
      </Card>

      {showPreview && (
        <Card className="p-4" data-cy="digest-preview-card">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-text">Preview</h3>
              <div className="mt-0.5 text-xs text-text-secondary">
                {new Date(preview.data?.window_start ?? '').toLocaleString()}
                {' — '}
                {new Date(preview.data?.window_end ?? '').toLocaleString()}
              </div>
            </div>
            {previewData && (
              <span className="text-xs text-text-tertiary">
                {previewData.recipients.length} recipient{previewData.recipients.length === 1 ? '' : 's'}
              </span>
            )}
          </div>
          <div data-cy="digest-preview-title" className="text-lg font-semibold text-text">
            {previewData?.title ?? '…'}
          </div>
          <div data-cy="digest-preview-recipients" className="mt-1 text-xs text-text-secondary break-all">
            To: {(previewData?.recipients ?? []).join(', ') || '(none configured)'}
          </div>
          {(previewData?.sections ?? []).length > 0 ? (
            <div className="mt-3 space-y-1.5">
              {(previewData?.sections ?? []).map((s) => (
                <div
                  key={s.key}
                  data-cy="digest-section-row"
                  className="flex items-center justify-between rounded-md border border-border-soft bg-surface-sunken/40 px-3 py-2"
                >
                  <span data-cy="digest-section-label" className="text-sm text-text-secondary">{s.label}</span>
                  <span data-cy="digest-section-count" className="text-sm font-semibold text-text">{s.count}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-3 text-xs text-text-tertiary">No activity in this window — the digest would be empty.</p>
          )}
        </Card>
      )}

      {history.error && (
        <div className="flex items-start gap-3 rounded-lg border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <Icon.Warning size={16} />
          <div>
            <strong className="font-semibold">Failed to load</strong>
            <p className="mt-0.5 text-xs opacity-90">{(history.error as Error).message}</p>
          </div>
        </div>
      )}

      {logs.length === 0 && !history.isLoading && (
        <Card data-cy="digest-empty">
          <EmptyState
            icon={<Icon.Mail size={20} />}
            title="No digests sent yet"
            description="The digest loop runs on schedule; hit Send now to generate the first one."
          />
        </Card>
      )}

      {logs.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-cy="digest-table">
              <thead className="bg-surface-sunken text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Sent</th>
                  <th className="px-5 py-2.5 font-medium">Summary</th>
                  <th className="px-5 py-2.5 font-medium">Recipients</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {logs.map((log) => (
                  <tr
                    key={log.id}
                    data-cy="digest-row"
                    data-digest-id={log.id}
                    className="transition-colors hover:bg-surface-hover"
                  >
                    <td data-cy="digest-sent-at" className="px-5 py-3 text-xs text-text-secondary whitespace-nowrap">
                      {new Date(log.sent_at).toLocaleString()}
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-text">Digest</div>
                      {totalCount(log.summary?.sections) > 0 && (
                        <div className="mt-0.5 text-xs text-text-tertiary">
                          {log.summary?.sections?.map((s) => `${s.label}: ${s.count}`).join(' · ')}
                        </div>
                      )}
                    </td>
                    <td data-cy="digest-recipients" className="px-5 py-3 text-xs text-text-secondary break-all max-w-[300px]">
                      {(log.recipients ?? []).join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

function totalCount(sections: DigestSection[] | undefined): number {
  return (sections ?? []).reduce((acc, s) => acc + s.count, 0);
}