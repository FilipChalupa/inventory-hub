import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import { mainNav, catalogNav, adminNav, type NavItem } from '../nav.js';
import { apiClient } from '../lib/api.js';
import { useCurrentUser } from '../auth/AuthContext.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { useT } from '../i18n/index.js';
import { StatusBadge } from './ui.js';

/**
 * Global command palette (Ctrl/⌘+K). Doubles as an app-wide asset search.
 * Mounted once inside the authenticated shell; opened by the keyboard shortcut
 * or imperatively via {@link openCommandPalette} (the top-bar "Search…" button).
 */

let paletteOpen = false;
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((l) => l());
}

function setOpen(next: boolean) {
  if (paletteOpen === next) return;
  paletteOpen = next;
  notify();
}

/** Opens the palette from anywhere (e.g. the top-bar search button). */
export function openCommandPalette() {
  setOpen(true);
}

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function CommandPalette() {
  const open = useSyncExternalStore(
    subscribe,
    () => paletteOpen,
    () => paletteOpen,
  );

  // Global shortcut: Ctrl+K / ⌘K toggles the palette. Registered once for the
  // lifetime of the shell, independent of whether the palette is open.
  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        setOpen(!paletteOpen);
      }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Remounted on every open (key), so query text and highlight reset for free.
  if (!open) return null;
  return <PaletteModal onClose={() => setOpen(false)} />;
}

const LIMIT = 6;

function PaletteModal({ onClose }: { onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const user = useCurrentUser();
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  // Element focused before the palette opened, restored on close.
  const openerRef = useRef<HTMLElement | null>(null);

  const q = query.trim();

  // Navigation targets, filtered by a case-insensitive substring on the label.
  const navItems = useMemo<NavItem[]>(() => {
    const all = [...mainNav, ...catalogNav, ...(user?.role === 'admin' ? adminNav : [])];
    const needle = q.toLowerCase();
    if (!needle) return all;
    return all.filter((item) => t.nav[item.key].toLowerCase().includes(needle));
  }, [q, user, t]);

  const debouncedQ = useDebouncedValue(q, 200);
  const assetsQuery = useQuery({
    queryKey: ['command-palette', 'assets', debouncedQ],
    queryFn: () => apiClient.assets.list({ q: debouncedQ, limit: LIMIT }),
    enabled: debouncedQ.length > 0,
    placeholderData: keepPreviousData,
  });
  const assetItems = debouncedQ.length > 0 ? (assetsQuery.data?.items ?? []) : [];
  const showAssetsSection = q.length > 0;

  const total = navItems.length + assetItems.length;

  // Keep the highlight in range as the composed list grows/shrinks.
  useEffect(() => {
    setActive((a) => (total === 0 ? 0 : Math.min(a, total - 1)));
  }, [total]);
  // Fresh query → start at the top.
  useEffect(() => {
    setActive(0);
  }, [q]);

  // Autofocus the input, trap Tab, and restore focus on close (mirrors
  // ConfirmDialog). Escape is handled here too so it works from anywhere.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    inputRef.current?.focus();
    function onKey(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusables = panel.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        );
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        if (!first || !last) return;
        const el = document.activeElement;
        if (e.shiftKey) {
          if (el === first || !panel.contains(el)) {
            e.preventDefault();
            last.focus();
          }
        } else if (el === last || !panel.contains(el)) {
          e.preventDefault();
          first.focus();
        }
      }
    }
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  function activate(index: number) {
    if (index < navItems.length) {
      const item = navItems[index];
      if (!item) return;
      onClose();
      navigate(item.to);
      return;
    }
    const asset = assetItems[index - navItems.length];
    if (!asset) return;
    onClose();
    navigate(`/a/${asset.code}`);
  }

  // Arrow / Enter drive the highlight over the whole composed list (with wrap)
  // while focus stays in the input.
  function onInputKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (total > 0) setActive((a) => (a + 1) % total);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (total > 0) setActive((a) => (a - 1 + total) % total);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (total > 0) activate(active);
    }
  }

  const rowClass = (index: number) =>
    clsx(
      'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
      index === active
        ? 'bg-slate-100 text-slate-900 dark:bg-slate-700 dark:text-white'
        : 'text-slate-700 dark:text-slate-200',
    );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[12vh] print:hidden"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={t.commandPalette.dialogLabel}
        className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xl dark:border-slate-700 dark:bg-slate-800"
      >
        <div className="border-b border-slate-200 dark:border-slate-700">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={t.commandPalette.placeholder}
            aria-label={t.commandPalette.placeholder}
            className="w-full bg-transparent px-4 py-3 text-sm text-slate-900 outline-none placeholder:text-slate-400 dark:text-slate-100"
          />
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {navItems.length > 0 && (
            <>
              <SectionHeader>{t.commandPalette.navSection}</SectionHeader>
              {navItems.map((item, i) => (
                <button
                  key={item.to}
                  type="button"
                  className={rowClass(i)}
                  onMouseMove={() => setActive(i)}
                  onClick={() => activate(i)}
                >
                  <span className="truncate">{t.nav[item.key]}</span>
                </button>
              ))}
            </>
          )}

          {showAssetsSection && (
            <>
              <SectionHeader>{t.commandPalette.assetsSection}</SectionHeader>
              {assetItems.length > 0 ? (
                assetItems.map((asset, j) => {
                  const index = navItems.length + j;
                  return (
                    <button
                      key={asset.id}
                      type="button"
                      className={rowClass(index)}
                      onMouseMove={() => setActive(index)}
                      onClick={() => activate(index)}
                    >
                      <span className="font-mono text-xs text-slate-500 dark:text-slate-400">
                        {asset.code}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{asset.name}</span>
                      <StatusBadge status={asset.status} />
                    </button>
                  );
                })
              ) : (
                <p className="px-3 py-2 text-sm text-slate-500 dark:text-slate-400">
                  {assetsQuery.isFetching ? t.commandPalette.loading : t.commandPalette.empty}
                </p>
              )}
            </>
          )}

          {navItems.length === 0 && !showAssetsSection && (
            <p className="px-3 py-6 text-center text-sm text-slate-500 dark:text-slate-400">
              {t.commandPalette.empty}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionHeader({ children }: { children: ReactNode }) {
  return (
    <div className="px-3 pb-1 pt-2 text-xs font-medium uppercase tracking-wide text-slate-400 dark:text-slate-500">
      {children}
    </div>
  );
}
