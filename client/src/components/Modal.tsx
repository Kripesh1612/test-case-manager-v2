// Generic confirmation modal.
//
// Used for delete confirmations and similar "are you sure?" flows.
// The parent owns open/closed state via a conditional render so that
// unmounting removes [data-cy="modal"] from the DOM entirely (matching
// what the existing Cypress tests expect after Cancel).
//
// Accessibility (focus-trap):
//   - role="dialog" + aria-modal="true" + aria-labelledby pointing at the
//     title so screen readers announce the dialog name on open.
//   - Escape closes the modal.
//   - Auto-focus moves to the cancel button on open (safer default for a
//     destructive "are you sure?" — Tab→Confirm requires an extra step).
//   - Tab cycles focus between Cancel and Confirm only (focus trap).
//     We use the actual mounted buttons rather than the well-known
//     ::focusable selector list because the modal content is small and
//     fixed; if more elements get added, switch to the selector list.

import { useEffect, useId, useRef } from 'react';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmModalProps) {
  // Stable ID for aria-labelledby. useId() gives us a per-instance
  // unique value that survives re-renders.
  const titleId = useId();
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  // Escape closes the modal — same behaviour as the vanilla UI.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
      if (e.key === 'Tab') {
        // Focus trap: keep Tab cycling between Cancel and Confirm.
        if (e.shiftKey && document.activeElement === cancelRef.current) {
          e.preventDefault();
          confirmRef.current?.focus();
        } else if (!e.shiftKey && document.activeElement === confirmRef.current) {
          e.preventDefault();
          cancelRef.current?.focus();
        }
      }
    }
    window.addEventListener('keydown', onKey);
    // Auto-focus Cancel on open — destructive-defaults opt-out by Tab.
    cancelRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      data-cy="modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded bg-white p-5 shadow-xl"
      >
        <h3
          id={titleId}
          data-cy="modal-title"
          className="mb-2 text-base font-semibold text-gray-900"
        >
          {title}
        </h3>
        <p className="mb-4 text-sm text-gray-700">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            data-cy="modal-cancel"
            onClick={onCancel}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            data-cy="modal-confirm"
            onClick={onConfirm}
            className={`rounded px-3 py-1 text-sm font-medium text-white focus:outline-none focus:ring-2 focus:ring-offset-2 ${
              danger
                ? 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
                : 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
