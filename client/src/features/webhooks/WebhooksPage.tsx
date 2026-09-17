// =============================================================================
// /admin/webhooks — admin-only webhook subscription management (Feature 1).
//
// Layout:
//   1. Page header explaining the feature + a "New webhook" button.
//   2. Webhooks list — one row per subscription: URL, event, enabled toggle,
//      delivery count, and actions (Test ping, History, Delete).
//   3. Create/Edit modal (always in the DOM, hidden like the invite modal so
//      Cypress can assert on visibility).
//   4. Delivery history drawer — 50 most recent delivery rows for a webhook.
//
// The data-cy contract is the feature's own (this page is new, not a React
// re-skin of a legacy vanilla page), so the hooks below are the source of
// truth for the Cypress API + UI specs.
// =============================================================================

import { useState } from 'react';

import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { EmptyState } from '@/components/EmptyState';
import { Icon } from '@/components/Icons';
import { ConfirmModal } from '@/components/Modal';
import { PageHeader } from '@/components/PageHeader';
import { showToast } from '@/lib/toast';

import type { Webhook } from './api';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useUpdateWebhook,
  useWebhookDeliveries,
  useWebhooks,
} from './hooks';

const EVENT_OPTIONS = ['suite.run.completed'];

interface FormState {
  url: string;
  secret: string;
  event: string;
  enabled: boolean;
}

const EMPTY_FORM: FormState = {
  url: '',
  secret: '',
  event: 'suite.run.completed',
  enabled: true,
};

type Pending =
  | { kind: 'delete'; webhook: Webhook }
  | null;

export function WebhooksPage() {
  const q = useWebhooks();
  const createM = useCreateWebhook();
  const updateM = useUpdateWebhook();
  const deleteM = useDeleteWebhook();
  const testM = useTestWebhook();

  const [modal, setModal] = useState<{ open: boolean; editing: Webhook | null; form: FormState; error: string | null }>({
    open: false,
    editing: null,
    form: EMPTY_FORM,
    error: null,
  });
  const [pending, setPending] = useState<Pending>(null);
  const [historyFor, setHistoryFor] = useState<Webhook | null>(null);

  const deliveries = useWebhookDeliveries(historyFor ? historyFor.id : null);

  const webhooks = q.data ?? [];

  // ---------- Create / edit handlers ----------
  function openCreate() {
    setModal({ open: true, editing: null, form: EMPTY_FORM, error: null });
  }

  function openEdit(w: Webhook) {
    setModal({
      open: true,
      editing: w,
      form: { url: w.url, secret: '', event: w.event, enabled: w.enabled },
      error: null,
    });
  }

  async function submitModal() {
    const url = modal.form.url.trim();
    if (!url) {
      setModal((s) => ({ ...s, error: 'Webhook URL is required' }));
      return;
    }
    try {
      if (modal.editing) {
        await updateM.mutateAsync({ id: modal.editing.id, ...modal.form });
        showToast({ message: 'Webhook updated', variant: 'success' });
      } else {
        await createM.mutateAsync(modal.form);
        showToast({ message: 'Webhook created', variant: 'success' });
      }
      setModal({ open: false, editing: null, form: EMPTY_FORM, error: null });
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string; details?: unknown[] } } }).response?.data
          : null;
      const detail = Array.isArray(msg?.details) && msg!.details!.length > 0
        ? `${(msg!.details![0] as { path?: string }).path ?? ''}: ${(msg!.details![0] as { message?: string }).message ?? ''}`.trim()
        : null;
      setModal((s) => ({ ...s, error: msg?.error ?? detail ?? 'Failed to save webhook' }));
    }
  }

  async function confirmPending() {
    if (!pending) return;
    const { webhook } = pending;
    setPending(null);
    try {
      await deleteM.mutateAsync(webhook.id);
      showToast({ message: 'Webhook deleted', variant: 'success' });
    } catch {
      // surfaced in useDeleteWebhook.onError
    }
  }

  async function ping(w: Webhook) {
    try {
      const res = await testM.mutateAsync(w.id);
      showToast({
        message: res.ok
          ? `Ping delivered (${res.attempts} attempt${res.attempts === 1 ? '' : 's'})`
          : `Ping failed after ${res.attempts} attempt(s)`,
        variant: res.ok ? 'success' : 'error',
      });
    } catch (e) {
      const msg =
        e && typeof e === 'object' && 'response' in e
          ? (e as { response?: { data?: { error?: string } } }).response?.data?.error
          : null;
      showToast({ message: msg ?? 'Ping request failed', variant: 'error' });
    }
  }

  // ---------- Render ----------
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Integrations"
        title="Webhooks"
        description="Notify external systems when test suites finish running. Each webhook receives a signed JSON payload over HTTP(S)."
      />

      <Card className="p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-xs text-text-secondary">
            Events fire after suite runs complete. Endpoints should respond 2xx to ack.
          </div>
          <Button
            type="button"
            variant="primary"
            size="sm"
            data-cy="webhook-new-btn"
            leftIcon={<Icon.Plus size={14} />}
            onClick={openCreate}
          >
            New webhook
          </Button>
        </div>
      </Card>

      {q.error && (
        <div className="flex items-start gap-3 rounded-lg border border-danger-border bg-danger-soft px-4 py-3 text-sm text-danger-text">
          <Icon.Warning size={16} />
          <div>
            <strong className="font-semibold">Failed to load</strong>
            <p className="mt-0.5 text-xs opacity-90">{(q.error as Error).message}</p>
          </div>
        </div>
      )}

      {webhooks.length === 0 && !q.isLoading && (
        <Card>
          <EmptyState
            icon={<Icon.Send size={20} />}
            title="No webhooks yet"
            description="Add one to get notified when suites finish running."
          />
        </Card>
      )}

      {webhooks.length > 0 && (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm" data-cy="webhook-table">
              <thead className="bg-surface-sunken text-left text-xs font-medium uppercase tracking-wider text-text-tertiary">
                <tr>
                  <th className="px-5 py-2.5 font-medium">Endpoint</th>
                  <th className="px-5 py-2.5 font-medium">Event</th>
                  <th className="px-5 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5 font-medium">Deliveries</th>
                  <th className="px-5 py-2.5 text-right font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {webhooks.map((w) => (
                  <tr
                    key={w.id}
                    data-cy="webhook-row"
                    data-webhook-id={w.id}
                    className="transition-colors hover:bg-surface-hover"
                  >
                    <td data-cy="webhook-url" className="px-5 py-3">
                      <div className="font-medium text-text break-all max-w-[340px]">{w.url}</div>
                      <div className="mt-0.5 text-xs text-text-tertiary">
                        {w.has_secret ? 'Signed' : 'Unsigned'}
                        {w.created_by_id != null ? ' · created by user' : ''}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <span className="role-pill role-editor">{w.event}</span>
                    </td>
                    <td className="px-5 py-3">
                      <span className={`role-pill ${w.enabled ? 'role-active' : 'role-draft'}`} data-cy="webhook-enabled">
                        {w.enabled ? 'enabled' : 'disabled'}
                      </span>
                    </td>
                    <td data-cy="webhook-delivery-count" className="px-5 py-3 text-xs text-text-secondary">
                      {w.delivery_count}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          type="button"
                          data-cy="webhook-toggle-btn"
                          className="btn small"
                          onClick={() =>
                            updateM.mutate({ id: w.id, enabled: !w.enabled })
                          }
                        >
                          {w.enabled ? 'Disable' : 'Enable'}
                        </button>
                        <button
                          type="button"
                          data-cy="webhook-test-btn"
                          className="btn small"
                          onClick={() => ping(w)}
                          disabled={testM.isPending}
                        >
                          {testM.isPending ? 'Pinging…' : 'Test'}
                        </button>
                        <button
                          type="button"
                          data-cy="webhook-history-btn"
                          data-id={w.id}
                          className="btn small"
                          onClick={() => setHistoryFor(w)}
                        >
                          History
                        </button>
                        <button
                          type="button"
                          data-cy="webhook-edit-btn"
                          className="btn small"
                          onClick={() => openEdit(w)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn small danger"
                          data-cy="webhook-delete-btn"
                          onClick={() => setPending({ kind: 'delete', webhook: w })}
                        >
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* ---------- Create / Edit modal ---------- */}
      <div
        data-cy="webhook-modal"
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
        style={{ display: modal.open ? 'flex' : 'none' }}
        onClick={() => setModal((s) => ({ ...s, open: false }))}
      >
        <div
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md rounded-card border border-border bg-surface p-6 shadow-[var(--shadow-pop)]"
          role="dialog"
          aria-modal="true"
        >
          <div className="mb-4 flex items-start gap-3">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-brand-soft text-brand">
              <Icon.Send size={16} />
            </span>
            <div>
              <h3 className="text-base font-semibold text-text">
                {modal.editing ? 'Edit webhook' : 'New webhook'}
              </h3>
              <p className="mt-0.5 text-xs text-text-secondary">
                Regress POSTs a JSON payload to this URL when the event fires. The
                shared secret signs the body via HMAC-SHA256.
              </p>
            </div>
          </div>

          {modal.error && (
            <div
              data-cy="webhook-modal-error"
              className="mb-3 flex items-start gap-2 rounded-md border border-danger-border bg-danger-soft px-3 py-2 text-xs text-danger-text"
            >
              <Icon.Warning size={14} />
              <span>{modal.error}</span>
            </div>
          )}

          <div className="space-y-3">
            <div>
              <label htmlFor="webhook-url" className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Endpoint URL
              </label>
              <input
                id="webhook-url"
                data-cy="webhook-url-input"
                type="url"
                autoComplete="off"
                value={modal.form.url}
                onChange={(e) => setModal((s) => ({ ...s, form: { ...s.form, url: e.target.value }, error: null }))}
                className="rg-input"
                placeholder="https://example.com/hooks/regress"
              />
            </div>

            <div>
              <label htmlFor="webhook-secret" className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Shared secret {modal.editing ? '(leave blank to keep current)' : ''}
              </label>
              <input
                id="webhook-secret"
                data-cy="webhook-secret-input"
                type="password"
                autoComplete="off"
                value={modal.form.secret}
                onChange={(e) => setModal((s) => ({ ...s, form: { ...s.form, secret: e.target.value }, error: null }))}
                className="rg-input"
                placeholder="X-Regress-Signature HMAC key"
              />
            </div>

            <div>
              <label htmlFor="webhook-event" className="mb-1 block text-xs font-medium uppercase tracking-wider text-text-tertiary">
                Event
              </label>
              <select
                id="webhook-event"
                data-cy="webhook-event-select"
                value={modal.form.event}
                onChange={(e) => setModal((s) => ({ ...s, form: { ...s.form, event: e.target.value } }))}
                className="rg-input"
              >
                {EVENT_OPTIONS.map((ev) => (
                  <option key={ev} value={ev}>{ev}</option>
                ))}
              </select>
            </div>

            <label
              data-cy="webhook-enabled-toggle"
              className="flex items-center gap-2 text-sm text-text-secondary"
            >
              <input
                type="checkbox"
                data-cy="webhook-enabled-input"
                checked={modal.form.enabled}
                onChange={(e) => setModal((s) => ({ ...s, form: { ...s.form, enabled: e.target.checked } }))}
              />
              Enabled
            </label>
          </div>

          <div className="mt-5 flex items-center justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              data-cy="webhook-modal-cancel"
              onClick={() => setModal((s) => ({ ...s, open: false }))}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="primary"
              data-cy="webhook-modal-confirm"
              onClick={submitModal}
              loading={createM.isPending || updateM.isPending}
              leftIcon={<Icon.Send size={14} />}
            >
              {createM.isPending || updateM.isPending ? 'Saving…' : modal.editing ? 'Save changes' : 'Create webhook'}
            </Button>
          </div>
        </div>
      </div>

      {/* ---------- Confirm delete ---------- */}
      {pending && (
        <ConfirmModal
          title="Delete webhook?"
          message={`${pending.webhook.url} will stop receiving events. Its delivery history is removed too.`}
          confirmLabel="Delete webhook"
          danger
          onConfirm={confirmPending}
          onCancel={() => setPending(null)}
        />
      )}

      {/* ---------- Delivery history drawer ---------- */}
      {historyFor && (
        <div
          data-cy="webhook-history-modal"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setHistoryFor(null)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-2xl rounded-card border border-border bg-surface p-6 shadow-[var(--shadow-pop)] max-h-[80vh] overflow-y-auto"
            role="dialog"
            aria-modal="true"
          >
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-text">Delivery history</h3>
                <p className="mt-0.5 text-xs text-text-secondary break-all">{historyFor.url}</p>
              </div>
              <button
                type="button"
                data-cy="webhook-history-close"
                className="btn small"
                onClick={() => setHistoryFor(null)}
              >
                Close
              </button>
            </div>

            {deliveries.isLoading && <div className="py-8 text-center text-sm text-text-secondary">Loading…</div>}

            {(deliveries.data ?? []).length === 0 && !deliveries.isLoading && (
              <EmptyState
                icon={<Icon.History size={20} />}
                title="No deliveries yet"
                description="Run a suite or hit Test to see delivery records here."
              />
            )}

            {(deliveries.data ?? []).length > 0 && (
              <div className="space-y-2">
                {(deliveries.data ?? []).map((d) => (
                  <div
                    key={d.id}
                    data-cy="webhook-delivery-row"
                    data-delivery-id={d.id}
                    className="rounded-lg border border-border-soft bg-surface-sunken/40 px-4 py-3"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span
                          data-cy="webhook-delivery-status"
                          className={`role-pill ${d.success ? 'role-active' : 'role-draft'}`}
                        >
                          {d.success ? `2xx` : `FAILED`}
                        </span>
                        <span className="text-xs text-text-tertiary">
                          {d.status_code != null ? `HTTP ${d.status_code}` : 'no response'}
                        </span>
                      </div>
                      <span className="text-xs text-text-tertiary">
                        {new Date(d.created_at).toLocaleString()}
                      </span>
                    </div>
                    {d.error && (
                      <div data-cy="webhook-delivery-error" className="mt-1 text-xs text-danger-text break-all">
                        {d.error}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}