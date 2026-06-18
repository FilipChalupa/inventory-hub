import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  WEEKDAY_LABELS,
  dayState,
  isSameDay,
  monthGridDays,
  monthTitle,
  type BusyWindow,
  type DayStatus,
} from '../lib/availability.js';

const dayClasses: Record<DayStatus, string> = {
  free: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  planned: 'bg-violet-100 text-violet-800 dark:bg-violet-900/40 dark:text-violet-200',
  active: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
};

/**
 * Month grid showing when an asset is free vs reserved/loaned. Navigates
 * between months locally; the caller just supplies the windows.
 */
export function AvailabilityCalendar({ windows }: { windows: BusyWindow[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));

  const grid = useMemo(() => monthGridDays(cursor.year, cursor.month), [cursor]);

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => shift(-1)}
          className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          aria-label="Předchozí měsíc"
        >
          ←
        </button>
        <span className="text-sm font-medium capitalize">
          {monthTitle(cursor.year, cursor.month)}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Dnes
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Další měsíc"
          >
            →
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAY_LABELS.map((label) => (
          <div
            key={label}
            className="text-center text-xs font-medium text-slate-400 dark:text-slate-500 pb-1"
          >
            {label}
          </div>
        ))}
        {grid.map((day) => {
          const state = dayState(windows, day);
          const inMonth = day.getMonth() === cursor.month;
          const isToday = isSameDay(day, today);
          const title = state.windows.map((w) => w.label).filter(Boolean).join(', ');
          return (
            <div
              key={day.toISOString()}
              title={title || undefined}
              className={clsx(
                'aspect-square rounded flex items-center justify-center text-xs',
                dayClasses[state.status],
                !inMonth && 'opacity-40',
                isToday && 'ring-2 ring-inset ring-slate-900 dark:ring-slate-100 font-semibold',
              )}
            >
              {day.getDate()}
            </div>
          );
        })}
      </div>

      <CalendarLegend />
    </div>
  );
}

export function CalendarLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      <LegendItem status="free" label="Volné" />
      <LegendItem status="active" label="Vypůjčeno" />
      <LegendItem status="planned" label="Rezervováno" />
    </div>
  );
}

function LegendItem({ status, label }: { status: DayStatus; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx('inline-block w-3 h-3 rounded', dayClasses[status])} />
      {label}
    </span>
  );
}
