// Generic confirmation modal.
//
// Used for delete confirmations and similar "are you sure?" flows.
// The parent owns open/closed state via a conditional render so that
// unmounting removes [data-cy="modal"] from the DOM entirely (matching
// what the existing Cypress tests expect after Cancel).

import { useEffect } from 'react';

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
  // Escape closes the modal — same behaviour as the vanilla UI.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      data-cy="modal"
      role="dialog"
      aria-modal="true"
      onClick={onCancel}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-sm rounded bg-white p-5 shadow-xl"
      >
        <h3 data-cy="modal-title" className="mb-2 text-base font-semibold text-gray-900">
          {title}
        </h3>
        <p className="mb-4 text-sm text-gray-700">{message}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            data-cy="modal-cancel"
            onClick={onCancel}
            className="rounded border border-gray-300 px-3 py-1 text-sm hover:bg-gray-50"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            data-cy="modal-confirm"
            onClick={onConfirm}
            className={`rounded px-3 py-1 text-sm font-medium text-white ${
              danger ? 'bg-red-600 hover:bg-red-700' : 'bg-blue-600 hover:bg-blue-700'
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
