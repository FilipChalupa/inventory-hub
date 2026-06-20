import { useSyncExternalStore } from 'react';
import clsx from 'clsx';

/**
 * Tiny imperative toast store. Lives at module scope so it can be fired from
 * anywhere — pages, mutation callbacks, the react-query MutationCache — without
 * threading a context through every component. Render <ToastViewport /> once.
 */
export type ToastKind = 'success' | 'error' | 'info';
type Toast = { id: number; kind: ToastKind; message: string };

let toasts: Toast[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit() {
  // New array identity so useSyncExternalStore notices the change.
  toasts = [...toasts];
  listeners.forEach((l) => l());
}

function dismiss(id: number) {
  toasts = toasts.filter((x) => x.id !== id);
  listeners.forEach((l) => l());
}

function push(kind: ToastKind, message: string) {
  const id = ++seq;
  toasts = [...toasts, { id, kind, message }];
  listeners.forEach((l) => l());
  // Errors linger a bit longer; they're more important to read.
  setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 4000);
  return id;
}

export const toast = {
  success: (message: string) => push('success', message),
  error: (message: string) => push('error', message),
  info: (message: string) => push('info', message),
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

const kindStyles: Record<ToastKind, string> = {
  success:
    'border-emerald-300 bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:border-emerald-700 dark:text-emerald-100',
  error:
    'border-red-300 bg-red-50 text-red-900 dark:bg-red-950/40 dark:border-red-700 dark:text-red-100',
  info: 'border-slate-300 bg-white text-slate-900 dark:bg-slate-800 dark:border-slate-600 dark:text-slate-100',
};

const kindIcon: Record<ToastKind, string> = { success: '✓', error: '⚠', info: 'ℹ' };

export function ToastViewport() {
  const items = useSyncExternalStore(subscribe, () => toasts, () => toasts);
  if (items.length === 0) return null;
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-50 flex flex-col items-center gap-2 p-4 print:hidden sm:items-end"
      aria-live="polite"
      role="status"
    >
      {items.map((item) => (
        <div
          key={item.id}
          className={clsx(
            'pointer-events-auto flex w-full max-w-sm items-start gap-2 rounded border px-3 py-2 text-sm shadow-lg',
            kindStyles[item.kind],
          )}
        >
          <span aria-hidden="true" className="mt-0.5 font-bold">
            {kindIcon[item.kind]}
          </span>
          <span className="flex-1 break-words">{item.message}</span>
          <button
            type="button"
            onClick={() => dismiss(item.id)}
            className="-mr-1 px-1 text-lg leading-none opacity-60 hover:opacity-100"
            aria-label="Zavřít"
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
