import clsx from 'clsx';
import type { ButtonHTMLAttributes, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, ReactNode } from 'react';
import { t } from '../i18n/messages.js';

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const buttonVariants: Record<ButtonVariant, string> = {
  primary:
    'bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-400 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white dark:disabled:bg-slate-600',
  secondary:
    'bg-white text-slate-900 border border-slate-300 hover:bg-slate-50 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600 dark:hover:bg-slate-700',
  danger: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-red-300',
  ghost:
    'text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-700',
};

export function Button({
  variant = 'primary',
  className,
  // Default to "button" so action buttons placed inside a <form> don't
  // accidentally submit it. Submit buttons set type="submit" explicitly.
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type={type}
      className={clsx(
        'inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition-colors',
        buttonVariants[variant],
        className,
      )}
      {...rest}
    />
  );
}

const formControl =
  'block w-full rounded border border-slate-300 px-3 py-2 text-sm bg-white text-slate-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={clsx(formControl, className)} {...rest} />;
}

export function Select({ className, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={clsx(formControl, className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={clsx(formControl, className)} {...rest} />;
}

export function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">
        {label}
      </span>
      {children}
      {error && <span className="block text-xs text-red-600 mt-1">{error}</span>}
    </label>
  );
}

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={clsx(
        'rounded border border-slate-200 bg-white p-4 dark:bg-slate-800 dark:border-slate-700',
        className,
      )}
    >
      {children}
    </div>
  );
}

const statusStyles: Record<string, string> = {
  in_stock: 'bg-emerald-100 text-emerald-800',
  assigned: 'bg-blue-100 text-blue-800',
  on_loan: 'bg-amber-100 text-amber-800',
  in_repair: 'bg-orange-100 text-orange-800',
  damaged: 'bg-red-100 text-red-800',
  sold: 'bg-slate-200 text-slate-700',
  lost: 'bg-slate-200 text-slate-700',
  retired: 'bg-slate-200 text-slate-700',
};

const statusLabels: Record<string, string> = t.asset.statuses;

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={clsx(
        'inline-block rounded px-2 py-0.5 text-xs font-medium',
        statusStyles[status] ?? 'bg-slate-100 text-slate-700',
      )}
    >
      {statusLabels[status] ?? status}
    </span>
  );
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  return d.toLocaleString('cs-CZ', { dateStyle: 'medium', timeStyle: 'short' });
}
