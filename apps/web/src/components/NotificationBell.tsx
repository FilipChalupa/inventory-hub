import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { apiClient, type NotificationItem, type NotificationSeverity } from '../lib/api.js';
import { getLocale, useT } from '../i18n/index.js';
import { localeTag } from '../i18n/util.js';

const REFETCH_MS = 60_000;

const SEVERITY_DOT: Record<NotificationSeverity, string> = {
  info: 'bg-sky-500',
  warning: 'bg-amber-500',
  danger: 'bg-rose-500',
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString(localeTag(getLocale()), {
    day: 'numeric',
    month: 'short',
  });
}

/**
 * Navigation bell exposing the derived, in-app notification feed. Polls the
 * server every {@link REFETCH_MS}ms, shows an unread badge, and opens a panel
 * that closes on Escape / outside-click / selecting an item. "Mark all read"
 * stamps the server-side seen time and clears the badge.
 */
export function NotificationBell() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const { data, isError } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => apiClient.notifications.list(),
    refetchInterval: REFETCH_MS,
    refetchOnWindowFocus: true,
  });

  const markSeen = useMutation({
    mutationFn: () => apiClient.notifications.markSeen(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const items = data?.items ?? [];
  const unread = data?.unreadCount ?? 0;

  function openItem(item: NotificationItem) {
    setOpen(false);
    navigate(item.link);
  }

  return (
    <div ref={ref} className="relative print:hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-label={
          unread > 0
            ? `${t.notifications.open} (${t.notifications.unread(unread)})`
            : t.notifications.open
        }
        onClick={() => setOpen((v) => !v)}
        className="relative rounded p-1.5 text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" className="h-6 w-6">
          <path d="M10 2a5 5 0 0 0-5 5v2.6l-1.3 2.6A1 1 0 0 0 4.6 14h10.8a1 1 0 0 0 .9-1.4L15 9.6V7a5 5 0 0 0-5-5Z" />
          <path d="M8 15a2 2 0 0 0 4 0H8Z" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-1 w-80 max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-slate-200 bg-white shadow-lg z-20 dark:border-slate-700 dark:bg-slate-800">
          <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-2 dark:border-slate-700">
            <span className="text-sm font-medium text-slate-900 dark:text-slate-100">
              {t.notifications.title}
            </span>
            {unread > 0 && (
              <button
                type="button"
                onClick={() => markSeen.mutate()}
                disabled={markSeen.isPending}
                className="text-xs text-sky-600 hover:underline disabled:opacity-50 dark:text-sky-400"
              >
                {t.notifications.markAllRead}
              </button>
            )}
          </div>

          <div className="max-h-96 overflow-y-auto">
            {isError ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {t.notifications.error}
              </p>
            ) : items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
                {t.notifications.empty}
              </p>
            ) : (
              <ul className="divide-y divide-slate-100 dark:divide-slate-700">
                {items.map((item) => (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => openItem(item)}
                      className="flex w-full gap-2.5 px-3 py-2.5 text-left hover:bg-slate-50 dark:hover:bg-slate-700/50"
                    >
                      <span
                        aria-hidden="true"
                        className={clsx(
                          'mt-1.5 h-2 w-2 shrink-0 rounded-full',
                          SEVERITY_DOT[item.severity],
                        )}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium text-slate-900 dark:text-slate-100">
                            {item.title}
                          </span>
                          <span className="shrink-0 text-xs text-slate-400 dark:text-slate-500">
                            {formatWhen(item.at)}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                          {item.message}
                        </span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
