import { loanWindowsOverlap } from '@inventory-hub/shared';
import { getLocale } from '../i18n/index.js';
import { localeTag, type Locale } from '../i18n/util.js';

/**
 * A single reservation/loan window projected onto the calendar. `end === null`
 * means open-ended (no expected return date). `status` mirrors the loan: a
 * `planned` window is a reservation that hasn't started yet, `active` is a
 * loan that is currently out.
 */
export type BusyWindow = {
  start: Date;
  end: Date | null;
  status: 'planned' | 'active';
  label?: string;
};

export type DayStatus = 'free' | 'planned' | 'active';

export type DayState = {
  status: DayStatus;
  /** Windows that overlap this day, for tooltips / details. */
  windows: BusyWindow[];
};

/** Local-day half-open bounds `[00:00, next-day 00:00)`. */
export function dayBounds(day: Date): [Date, Date] {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  const end = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
  return [start, end];
}

/**
 * Whether a calendar day is free or covered by a window. An active loan wins
 * over a planned reservation when both touch the same day.
 */
export function dayState(windows: BusyWindow[], day: Date): DayState {
  const [start, end] = dayBounds(day);
  const hits = windows.filter((w) => loanWindowsOverlap(start, end, w.start, w.end));
  if (hits.length === 0) return { status: 'free', windows: [] };
  const status: DayStatus = hits.some((w) => w.status === 'active') ? 'active' : 'planned';
  return { status, windows: hits };
}

/** Whether a calendar day carries no commitment (free to be part of a loan). */
export function isLoanDayFree(windows: BusyWindow[], day: Date): boolean {
  return dayState(windows, day).status === 'free';
}

/**
 * The furthest day reachable from `start` without crossing a busy day, so a
 * range selection can never span an existing commitment. `start` is assumed
 * free; the result is always >= start and <= target.
 */
export function clampLoanRange(windows: BusyWindow[], start: Date, target: Date): Date {
  let end = start;
  const cursor = new Date(start);
  while (cursor.getTime() <= target.getTime()) {
    if (!isLoanDayFree(windows, cursor)) break;
    end = new Date(cursor);
    cursor.setDate(cursor.getDate() + 1);
  }
  return end;
}

export type NextFree = { kind: 'now' } | { kind: 'date'; date: Date } | { kind: 'never' };

/**
 * The moment an asset is next free, walking forward from `from` and jumping
 * past each covering window (so back-to-back loans collapse). `now` = free
 * already; `never` = an open-ended loan currently covers it.
 */
export function nextFreeAt(windows: BusyWindow[], from: Date = new Date()): NextFree {
  let cursor = from;
  // Bounded loop: at most one jump per window.
  for (let i = 0; i <= windows.length; i++) {
    const covering = windows.find(
      (w) =>
        w.start.getTime() <= cursor.getTime() &&
        (w.end === null || cursor.getTime() < w.end.getTime()),
    );
    if (!covering) break;
    if (covering.end === null) return { kind: 'never' };
    cursor = covering.end;
  }
  return cursor.getTime() <= from.getTime() ? { kind: 'now' } : { kind: 'date', date: cursor };
}

/**
 * The 6×7 day matrix for a month, Monday-first, including the trailing/leading
 * days of the neighbouring months that fill the grid.
 */
export function monthGridDays(year: number, month: number): Date[] {
  const first = new Date(year, month, 1);
  // getDay(): 0=Sun … 6=Sat → shift so Monday is column 0.
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(year, month, 1 - offset);
  return Array.from(
    { length: 42 },
    (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i),
  );
}

/** Half-open `[start, end)` range covered by the 6×7 month grid. */
export function monthGridRange(year: number, month: number): [Date, Date] {
  const days = monthGridDays(year, month);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  return [first, new Date(last.getFullYear(), last.getMonth(), last.getDate() + 1)];
}

/** Day numbers `1…n` of the given month. */
export function daysInMonth(year: number, month: number): Date[] {
  const count = new Date(year, month + 1, 0).getDate();
  return Array.from({ length: count }, (_, i) => new Date(year, month, i + 1));
}

/** Local `YYYY-MM-DD` (for `<input type="date">` / deep-link params). */
export function toISODate(d: Date): string {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd}`;
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Monday-first short weekday headers in the active locale. */
const WEEKDAY_LABELS_BY_LOCALE: Record<Locale, readonly string[]> = {
  cs: ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'],
  en: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};

export function weekdayLabels(): readonly string[] {
  return WEEKDAY_LABELS_BY_LOCALE[getLocale()];
}

export function monthTitle(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString(localeTag(getLocale()), {
    month: 'long',
    year: 'numeric',
  });
}

// Statuses that block a loan regardless of the time window (mirrors the
// server's LOANABLE_STATUSES / STATUS_UNAVAILABLE_REASON). in_stock and
// on_loan are loanable, so they map to null.
const NON_LOANABLE_REASON: Record<Locale, Record<string, string>> = {
  cs: {
    assigned: 'přiřazeno uživateli',
    in_repair: 'v opravě',
    damaged: 'poškozeno',
    sold: 'prodáno',
    lost: 'ztraceno',
    retired: 'vyřazeno',
  },
  en: {
    assigned: 'assigned to a user',
    in_repair: 'in repair',
    damaged: 'damaged',
    sold: 'sold',
    lost: 'lost',
    retired: 'retired',
  },
};

/** Why an asset can't be loaned based purely on its status, or null if it can. */
export function nonLoanableReason(status: string): string | null {
  return NON_LOANABLE_REASON[getLocale()][status] ?? null;
}

/** Diagonal hatch overlay marking days where availability doesn't apply. */
export const HATCH_STYLE: Record<string, string> = {
  backgroundImage:
    'repeating-linear-gradient(45deg, rgba(100,116,139,0.30) 0, rgba(100,116,139,0.30) 2px, transparent 2px, transparent 6px)',
};
