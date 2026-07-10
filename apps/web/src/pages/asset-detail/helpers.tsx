import { getLocale } from '../../i18n/index.js';
import { localeTag } from '../../i18n/util.js';

export function FragmentRow({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-slate-500">{label}</dt>
      <dd>{value || '—'}</dd>
    </>
  );
}

/** Formats a minor-unit (cents) amount as a localized decimal, or '—'. */
export function formatPrice(cents: number | null | undefined): string {
  if (cents == null) return '—';
  return new Intl.NumberFormat(localeTag(getLocale()), {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

const WARRANTY_SOON_DAYS = 30;

/**
 * Classifies a warranty end date relative to now: 'expired' once it has
 * passed, 'soon' within the next 30 days, otherwise null (no emphasis).
 */
export function warrantyStatus(warrantyUntil: Date | null): 'expired' | 'soon' | null {
  if (!warrantyUntil) return null;
  const now = Date.now();
  const end = new Date(warrantyUntil).getTime();
  if (end < now) return 'expired';
  if (end - now <= WARRANTY_SOON_DAYS * 24 * 60 * 60 * 1000) return 'soon';
  return null;
}

/**
 * Classifies the next-service date relative to now: 'overdue' once it has
 * passed, 'soon' within the next 30 days, otherwise null (no emphasis).
 * Mirrors {@link warrantyStatus} so both lifecycle cues read consistently.
 */
export function serviceStatus(nextDue: Date | null): 'overdue' | 'soon' | null {
  if (!nextDue) return null;
  const now = Date.now();
  const due = new Date(nextDue).getTime();
  if (due < now) return 'overdue';
  if (due - now <= WARRANTY_SOON_DAYS * 24 * 60 * 60 * 1000) return 'soon';
  return null;
}

/** Converts a Date to the 'YYYY-MM-DD' value a <input type="date"> expects. */
export function toDateInput(value: Date | null): string {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

export function formatCustomFieldValue(
  type: string,
  value: unknown,
  labels: { yes: string; no: string },
): string {
  if (value === undefined || value === null || value === '') return '';
  switch (type) {
    case 'boolean':
      return value ? labels.yes : labels.no;
    case 'date':
      return typeof value === 'string'
        ? new Date(value).toLocaleDateString(localeTag(getLocale()))
        : String(value);
    default:
      return String(value);
  }
}
