import { loanWindowsOverlap } from '@inventory-hub/shared';

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

/** Monday-first short weekday headers in Czech. */
export const WEEKDAY_LABELS = ['Po', 'Út', 'St', 'Čt', 'Pá', 'So', 'Ne'] as const;

export function monthTitle(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString('cs-CZ', {
    month: 'long',
    year: 'numeric',
  });
}

// Statuses that block a loan regardless of the time window (mirrors the
// server's LOANABLE_STATUSES / STATUS_UNAVAILABLE_REASON). in_stock and
// on_loan are loanable, so they map to null.
const NON_LOANABLE_REASON: Record<string, string> = {
  assigned: 'přiřazeno uživateli',
  in_repair: 'v opravě',
  damaged: 'poškozeno',
  sold: 'prodáno',
  lost: 'ztraceno',
  retired: 'vyřazeno',
};

/** Why an asset can't be loaned based purely on its status, or null if it can. */
export function nonLoanableReason(status: string): string | null {
  return NON_LOANABLE_REASON[status] ?? null;
}

/** Diagonal hatch overlay marking days where availability doesn't apply. */
export const HATCH_STYLE: Record<string, string> = {
  backgroundImage:
    'repeating-linear-gradient(45deg, rgba(100,116,139,0.30) 0, rgba(100,116,139,0.30) 2px, transparent 2px, transparent 6px)',
};
