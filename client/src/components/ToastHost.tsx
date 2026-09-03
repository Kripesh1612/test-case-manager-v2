// Renders the active toast queue. Mount once near the root of the app.
//
// Auto-dismisses each toast after its `duration` ms (default 4000).
// Clicking the action button fires the action and dismisses the toast.
// Clicking the × button just dismisses.

import { useEffect, useState } from 'react';

import { dismissToast, getToasts, subscribeToasts, type Toast } from '@/lib/toast';

export function ToastHost() {
  const [toasts, setToasts] = useState<Toast[]>(getToasts());

  useEffect(() => subscribeToasts(() => setToasts(getToasts())), []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <ToastCard key={t.id} toast={t} />
      ))}
    </div>
  );
}

function ToastCard({ toast }: { toast: Toast }) {
  useEffect(() => {
    if (toast.duration <= 0) return;
    const handle = setTimeout(() => dismissToast(toast.id), toast.duration);
    return () => clearTimeout(handle);
  }, [toast.id, toast.duration]);

  const baseColor =
    toast.variant === 'success'
      ? 'border-green-300 bg-green-50 text-green-900'
      : 'border-red-300 bg-red-50 text-red-900';

  return (
    <div
      data-cy="toast"
      data-cy-toast={toast.variant}
      role="status"
      className={`pointer-events-auto flex items-center gap-3 rounded border px-4 py-2 text-sm shadow ${baseColor}`}
    >
      <span className="flex-1">{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          data-cy="toast-action"
          onClick={() => {
            toast.action?.onClick();
            dismissToast(toast.id);
          }}
          className="rounded border border-current px-2 py-0.5 text-xs font-medium hover:bg-white/50"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => dismissToast(toast.id)}
        aria-label="Dismiss"
        className="text-base leading-none text-current opacity-60 hover:opacity-100"
      >
        ×
      </button>
    </div>
  );
}
