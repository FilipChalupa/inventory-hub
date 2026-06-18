import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  HATCH_STYLE,
  WEEKDAY_LABELS,
  dayBounds,
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

const blockedDayClass = 'bg-slate-100 text-slate-400 dark:bg-slate-700/40 dark:text-slate-500';

/**
 * Month grid showing when an asset is free vs reserved/loaned. Navigates
 * between months locally; the caller just supplies the windows.
 *
 * `blocked` marks an asset that can't be loaned right now (in repair, damaged,
 * …): a banner explains why and free days from today on are hatched out,
 * because their "free" status is only theoretical until the asset is back.
 */
export function AvailabilityCalendar({
  windows,
  blocked,
}: {
  windows: BusyWindow[];
  blocked?: { reason: string };
}) {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
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
      {blocked && (
        <div className="mb-2 rounded border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-700 dark:bg-amber-900/30 dark:text-amber-200">
          Asset teď nelze půjčit ({blocked.reason}). Volné dny od dneška jsou orientační, dokud se
          nevrátí mezi dostupné.
        </div>
      )}
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
          // A blocking status hatches out otherwise-free days from today on.
          const isBlocked =
            !!blocked &&
            state.status === 'free' &&
            dayBounds(day)[0].getTime() >= todayStart.getTime();
          const title = isBlocked
            ? blocked.reason
            : state.windows.map((w) => w.label).filter(Boolean).join(', ');
          return (
            <div
              key={day.toISOString()}
              title={title || undefined}
              style={isBlocked ? HATCH_STYLE : undefined}
              className={clsx(
                'aspect-square rounded flex items-center justify-center text-xs',
                isBlocked ? blockedDayClass : dayClasses[state.status],
                !inMonth && 'opacity-40',
                isToday && 'ring-2 ring-inset ring-slate-900 dark:ring-slate-100 font-semibold',
              )}
            >
              {day.getDate()}
            </div>
          );
        })}
      </div>

      <CalendarLegend blocked={!!blocked} />
    </div>
  );
}

export function CalendarLegend({ blocked = false }: { blocked?: boolean }) {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
      <LegendItem status="free" label="Volné" />
      <LegendItem status="active" label="Vypůjčeno" />
      <LegendItem status="planned" label="Rezervováno" />
      {blocked && (
        <span className="inline-flex items-center gap-1.5">
          <span
            className={clsx('inline-block w-3 h-3 rounded', blockedDayClass)}
            style={HATCH_STYLE}
          />
          Nedostupné
        </span>
      )}
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
