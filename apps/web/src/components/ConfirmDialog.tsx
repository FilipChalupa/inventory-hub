import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Button } from './ui.js';
import { useT } from '../i18n/index.js';

/**
 * Imperative confirmation dialog: `await confirm({ ... })` resolves true/false.
 * A modal replacement for window.confirm that can show real context (item
 * names, consequences) and matches the app's styling. Render <ConfirmViewport />
 * once. Only one prompt is shown at a time.
 */
export type ConfirmOptions = {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type Pending = { opts: ConfirmOptions; resolve: (ok: boolean) => void };

let current: Pending | null = null;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function settle(ok: boolean) {
  current?.resolve(ok);
  current = null;
  notify();
}

export function confirm(opts: ConfirmOptions): Promise<boolean> {
  // Any in-flight prompt is implicitly cancelled before a new one opens.
  current?.resolve(false);
  return new Promise<boolean>((resolve) => {
    current = { opts, resolve };
    notify();
  });
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function ConfirmViewport() {
  const t = useT();
  const pending = useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
  const confirmRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // The element focused before the dialog opened, so focus can be restored
  // to it once the dialog closes (keyboard users don't lose their place).
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!pending) return;
    openerRef.current = document.activeElement as HTMLElement | null;
    confirmRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        settle(false);
        return;
      }
      // Focus trap: keep Tab / Shift+Tab cycling within the dialog panel.
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || !panel.contains(active)) {
            e.preventDefault();
            last.focus();
          }
        } else if (active === last || !panel.contains(active)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      // Restore focus to whatever opened the dialog.
      openerRef.current?.focus?.();
    };
  }, [pending]);

  if (!pending) return null;
  const { opts } = pending;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 print:hidden"
      onMouseDown={(e) => {
        // Backdrop click (not a click that started inside the panel) cancels.
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={opts.title}
        className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-5 shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <h2 className="text-lg font-semibold">{opts.title}</h2>
        {opts.message && (
          <p className="mt-2 text-sm text-slate-600 dark:text-slate-300">{opts.message}</p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => settle(false)}>
            {opts.cancelLabel ?? t.common.cancel}
          </Button>
          <Button
            ref={confirmRef}
            variant={opts.danger ? 'danger' : 'primary'}
            onClick={() => settle(true)}
          >
            {opts.confirmLabel ?? t.common.confirm}
          </Button>
        </div>
      </div>
    </div>
  );
}
