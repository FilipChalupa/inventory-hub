import { describe, it, expect } from 'vitest';
import {
  clampLoanRange,
  dayBounds,
  dayState,
  daysInMonth,
  isLoanDayFree,
  isSameDay,
  monthGridDays,
  monthGridRange,
  nextFreeAt,
  nonLoanableReason,
  toISODate,
  type BusyWindow,
} from './availability.js';

const d = (y: number, m: number, day: number, h = 0) => new Date(y, m, day, h);

describe('dayBounds', () => {
  it('returns the local midnight-to-midnight half-open range', () => {
    const [start, end] = dayBounds(d(2026, 0, 15, 13));
    expect(start).toEqual(d(2026, 0, 15));
    expect(end).toEqual(d(2026, 0, 16));
  });
});

describe('dayState', () => {
  const active: BusyWindow = { start: d(2026, 0, 10), end: d(2026, 0, 20), status: 'active' };
  const planned: BusyWindow = { start: d(2026, 0, 10), end: d(2026, 0, 20), status: 'planned' };

  it('is free with no windows', () => {
    expect(dayState([], d(2026, 0, 15)).status).toBe('free');
  });

  it('marks a covered day busy by the window status', () => {
    expect(dayState([active], d(2026, 0, 15)).status).toBe('active');
    expect(dayState([planned], d(2026, 0, 15)).status).toBe('planned');
  });

  it('lets an active window win over a planned one on the same day', () => {
    expect(dayState([planned, active], d(2026, 0, 15)).status).toBe('active');
  });

  it('treats the end day as free (half-open interval)', () => {
    // window ends at 2026-01-20 00:00 → that day is no longer occupied
    expect(dayState([active], d(2026, 0, 20)).status).toBe('free');
    expect(dayState([active], d(2026, 0, 19)).status).toBe('active');
  });

  it('treats a null end as open-ended (always busy from start on)', () => {
    const open: BusyWindow = { start: d(2026, 0, 10), end: null, status: 'active' };
    expect(dayState([open], d(2030, 5, 1)).status).toBe('active');
    expect(dayState([open], d(2026, 0, 9)).status).toBe('free');
  });
});

describe('monthGridDays', () => {
  it('produces a 42-day Monday-first grid containing the month', () => {
    const grid = monthGridDays(2026, 0); // January 2026 (1st is a Thursday)
    expect(grid).toHaveLength(42);
    expect(grid[0]!.getDay()).toBe(1); // Monday
    expect(grid.some((x) => isSameDay(x, d(2026, 0, 1)))).toBe(true);
    expect(grid.some((x) => isSameDay(x, d(2026, 0, 31)))).toBe(true);
  });
});

describe('monthGridRange', () => {
  it('spans from the first grid day to the day after the last', () => {
    const grid = monthGridDays(2026, 0);
    const [from, to] = monthGridRange(2026, 0);
    expect(from).toEqual(grid[0]);
    expect(to).toEqual(
      new Date(grid[41]!.getFullYear(), grid[41]!.getMonth(), grid[41]!.getDate() + 1),
    );
  });
});

describe('daysInMonth', () => {
  it('counts days, honouring leap years', () => {
    expect(daysInMonth(2024, 1)).toHaveLength(29); // Feb 2024 (leap)
    expect(daysInMonth(2025, 1)).toHaveLength(28); // Feb 2025
    expect(daysInMonth(2026, 3)).toHaveLength(30); // April
    expect(daysInMonth(2026, 0)[0]).toEqual(d(2026, 0, 1));
  });
});

describe('toISODate', () => {
  it('formats a zero-padded local date', () => {
    expect(toISODate(d(2026, 0, 5))).toBe('2026-01-05');
    expect(toISODate(d(2026, 11, 31))).toBe('2026-12-31');
  });
});

describe('isSameDay', () => {
  it('ignores the time component', () => {
    expect(isSameDay(d(2026, 0, 1, 0), d(2026, 0, 1, 23))).toBe(true);
    expect(isSameDay(d(2026, 0, 1), d(2026, 0, 2))).toBe(false);
  });
});

describe('nextFreeAt', () => {
  const from = d(2026, 0, 10);

  it('is "now" when nothing covers the start', () => {
    expect(nextFreeAt([], from).kind).toBe('now');
    // a window entirely in the future leaves the asset free now
    const future: BusyWindow = { start: d(2026, 0, 20), end: d(2026, 0, 25), status: 'planned' };
    expect(nextFreeAt([future], from).kind).toBe('now');
  });

  it('returns the end date when a window covers the start', () => {
    const w: BusyWindow = { start: d(2026, 0, 5), end: d(2026, 0, 15), status: 'active' };
    expect(nextFreeAt([w], from)).toEqual({ kind: 'date', date: d(2026, 0, 15) });
  });

  it('collapses back-to-back windows', () => {
    const a: BusyWindow = { start: d(2026, 0, 5), end: d(2026, 0, 15), status: 'active' };
    const b: BusyWindow = { start: d(2026, 0, 15), end: d(2026, 0, 20), status: 'planned' };
    expect(nextFreeAt([a, b], from)).toEqual({ kind: 'date', date: d(2026, 0, 20) });
  });

  it('is "never" when an open-ended window covers the start', () => {
    const open: BusyWindow = { start: d(2026, 0, 1), end: null, status: 'active' };
    expect(nextFreeAt([open], from).kind).toBe('never');
  });
});

describe('isLoanDayFree', () => {
  const busy: BusyWindow = { start: d(2026, 0, 12), end: d(2026, 0, 13), status: 'active' };

  it('is true for an uncommitted day and false for a covered one', () => {
    expect(isLoanDayFree([busy], d(2026, 0, 11))).toBe(true);
    expect(isLoanDayFree([busy], d(2026, 0, 12))).toBe(false);
  });
});

describe('clampLoanRange', () => {
  it('returns the target when every day in between is free', () => {
    expect(clampLoanRange([], d(2026, 0, 10), d(2026, 0, 15))).toEqual(d(2026, 0, 15));
  });

  it('stops on the last free day before a busy one', () => {
    const busy: BusyWindow = { start: d(2026, 0, 12), end: d(2026, 0, 13), status: 'active' };
    expect(clampLoanRange([busy], d(2026, 0, 10), d(2026, 0, 20))).toEqual(d(2026, 0, 11));
  });

  it('collapses to the start for a single free day', () => {
    expect(clampLoanRange([], d(2026, 0, 10), d(2026, 0, 10))).toEqual(d(2026, 0, 10));
  });

  it('never extends past the target even if more free days follow', () => {
    expect(clampLoanRange([], d(2026, 0, 10), d(2026, 0, 12))).toEqual(d(2026, 0, 12));
  });
});

describe('nonLoanableReason', () => {
  it('returns null for loanable statuses', () => {
    expect(nonLoanableReason('in_stock')).toBeNull();
    expect(nonLoanableReason('on_loan')).toBeNull();
  });

  it('returns a Czech reason for blocking statuses', () => {
    expect(nonLoanableReason('in_repair')).toBe('v opravě');
    expect(nonLoanableReason('assigned')).toBe('přiřazeno uživateli');
    expect(nonLoanableReason('sold')).toBe('prodáno');
  });

  it('returns null for unknown statuses', () => {
    expect(nonLoanableReason('whatever')).toBeNull();
  });
});
