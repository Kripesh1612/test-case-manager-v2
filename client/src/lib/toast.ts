// Tiny module-level toast queue.
//
// We don't need React Context for this — the showToast() function can
// be called from anywhere (including from TanStack Query mutation
// onSuccess handlers and from event handlers deep in the tree), and
// the ToastHost component subscribes via subscribeToasts().
//
// Matches the data-cy contract the existing Cypress UI tests expect:
//   <div data-cy="toast" data-cy-toast="success|error">
//     <span>message</span>
//     <button data-cy="toast-action">Open Trash</button>   (optional)
//   </div>

export type ToastVariant = 'success' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  action?: ToastAction;
  /** ms before auto-dismiss. Default 4000. Pass 0 to disable. */
  duration?: number;
}

export interface Toast {
  id: number;
  message: string;
  variant: ToastVariant;
  action?: ToastAction;
  duration: number;
}

const DEFAULT_DURATION = 4000;

let nextId = 1;
const toasts: Toast[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

export function showToast(opts: ToastOptions): number {
  const id = nextId++;
  const toast: Toast = {
    id,
    message: opts.message,
    variant: opts.variant ?? 'success',
    action: opts.action,
    duration: opts.duration ?? DEFAULT_DURATION,
  };
  toasts.push(toast);
  emit();
  return id;
}

export function dismissToast(id: number): void {
  const idx = toasts.findIndex((t) => t.id === id);
  if (idx >= 0) {
    toasts.splice(idx, 1);
    emit();
  }
}

export function getToasts(): Toast[] {
  // Always return a fresh array reference. The ToastHost calls
  // setToasts(getToasts()) on every subscriber event, and React's
  // useState bails out on Object.is equality — so returning the same
  // array would silently break the subscription.
  return toasts.slice();
}

export function subscribeToasts(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
