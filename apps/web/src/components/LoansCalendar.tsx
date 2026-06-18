import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { apiClient, type LoanScheduleRow } from '../lib/api.js';
import {
  WEEKDAY_LABELS,
  isSameDay,
  monthGridDays,
  monthGridRange,
  monthTitle,
} from '../lib/availability.js';

type LoanEvent = {
  loanId: string;
  borrowerName: string;
  itemCount: number;
  kind: 'start' | 'return';
  overdue: boolean;
};

const MAX_PER_DAY = 3;

/**
 * Loan-centric month calendar: each day shows the loans that *start* (▶) or
 * are *due back* (⮐) that day, so whoever hands the gear out can plan pickups
 * and returns. Overdue returns are flagged red.
 */
export function LoansCalendar() {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));

  const [from, to] = useMemo(
    () => monthGridRange(cursor.year, cursor.month),
    [cursor],
  );
  const grid = useMemo(() => monthGridDays(cursor.year, cursor.month), [cursor]);

  const schedule = useQuery({
    queryKey: ['loan-schedule', from.toISOString(), to.toISOString()],
    queryFn: () =>
      apiClient.loans.schedule({ from: from.toISOString(), to: to.toISOString() }),
  });

  // Bucket start/return events by day key (local date).
  const eventsByDay = useMemo(() => {
    const map = new Map<string, LoanEvent[]>();
    const push = (day: Date, ev: LoanEvent) => {
      const key = dayKey(day);
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    };
    for (const loan of schedule.data?.items ?? []) {
      const start = new Date(loan.start);
      push(start, {
        loanId: loan.id,
        borrowerName: loan.borrowerName,
        itemCount: loan.itemCount,
        kind: 'start',
        overdue: false,
      });
      if (loan.end) {
        const end = new Date(loan.end);
        const overdue =
          loan.status !== 'planned' &&
          new Date(end.getFullYear(), end.getMonth(), end.getDate()).getTime() <
            todayStart.getTime();
        push(end, {
          loanId: loan.id,
          borrowerName: loan.borrowerName,
          itemCount: loan.itemCount,
          kind: 'return',
          overdue,
        });
      }
    }
    return map;
  }, [schedule.data, todayStart]);

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Předchozí měsíc"
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Další měsíc"
          >
            →
          </button>
          <span className="ml-2 text-sm font-medium capitalize">
            {monthTitle(cursor.year, cursor.month)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
          className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
        >
          Dnes
        </button>
      </div>

      {schedule.error && (
        <p className="text-sm text-red-600 mb-2">{(schedule.error as Error).message}</p>
      )}

      <div className="grid grid-cols-7 gap-px rounded border border-slate-200 bg-slate-200 dark:border-slate-700 dark:bg-slate-700 overflow-hidden">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="bg-slate-50 text-center text-xs font-medium text-slate-400 py-1 dark:bg-slate-800 dark:text-slate-500"
          >
            {label}
          </div>
        ))}
        {grid.map((day) => {
          const inMonth = day.getMonth() === cursor.month;
          const isToday = isSameDay(day, today);
          const events = eventsByDay.get(dayKey(day)) ?? [];
          return (
            <div
              key={day.toISOString()}
              className={clsx(
                'min-h-20 bg-white p-1 dark:bg-slate-800',
                !inMonth && 'bg-slate-50 dark:bg-slate-800/50',
              )}
            >
              <div
                className={clsx(
                  'text-xs mb-0.5 px-1',
                  inMonth ? 'text-slate-500 dark:text-slate-400' : 'text-slate-300 dark:text-slate-600',
                  isToday &&
                    'inline-block rounded bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold',
                )}
              >
                {day.getDate()}
              </div>
              <div className="space-y-0.5">
                {events.slice(0, MAX_PER_DAY).map((ev, i) => (
                  <EventChip key={`${ev.loanId}-${ev.kind}-${i}`} event={ev} />
                ))}
                {events.length > MAX_PER_DAY && (
                  <div className="text-[10px] text-slate-400 px-1">
                    +{events.length - MAX_PER_DAY} dalších
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <Legend />
    </div>
  );
}

function EventChip({ event }: { event: LoanEvent }) {
  const cls = event.overdue
    ? 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200'
    : event.kind === 'start'
      ? 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200'
      : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200';
  return (
    <Link
      to={`/loans/${event.loanId}`}
      title={`${event.kind === 'start' ? 'Začátek' : 'Vrácení'}: ${event.borrowerName} (${event.itemCount} ks)`}
      className={clsx('block truncate rounded px-1 py-0.5 text-[11px] hover:opacity-80', cls)}
    >
      {event.kind === 'start' ? '▶' : '⮐'} {event.borrowerName}
    </Link>
  );
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded bg-violet-100 dark:bg-violet-900/40" />▶ Začátek
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded bg-amber-100 dark:bg-amber-900/40" />⮐ Vrácení
      </span>
      <span className="inline-flex items-center gap-1.5">
        <span className="inline-block w-3 h-3 rounded bg-red-100 dark:bg-red-900/40" />Po termínu
      </span>
    </div>
  );
}

function dayKey(d: Date): string {
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}
