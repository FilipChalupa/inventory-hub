import { useMemo, useState } from 'react';
import clsx from 'clsx';
import { Button } from './ui.js';
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

function statusLabel(status: DayStatus | 'blocked'): string {
  switch (status) {
    case 'free':
      return 'volné';
    case 'active':
      return 'vypůjčeno';
    case 'planned':
      return 'rezervováno';
    case 'blocked':
      return 'nedostupné';
  }
}

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
  onCreateLoan,
}: {
  windows: BusyWindow[];
  blocked?: { reason: string };
  /** When set, free days from today on can be range-selected to start a loan. */
  onCreateLoan?: (from: Date, to: Date) => void;
}) {
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const [sel, setSel] = useState<{ start: Date; end: Date | null } | null>(null);

  const grid = useMemo(() => monthGridDays(cursor.year, cursor.month), [cursor]);

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  // A day that can be part of a loan window: free (no commitment) and not
  // hatched out by a blocking status.
  function isFreeForLoan(day: Date): boolean {
    const st = dayState(windows, day);
    if (st.status !== 'free') return false;
    if (blocked && dayBounds(day)[0].getTime() >= todayStart.getTime()) return false;
    return true;
  }

  // Clamp the range end to the last day reachable from `start` without
  // crossing a busy/blocked day, so a selection can never span a commitment.
  function clampEnd(start: Date, target: Date): Date {
    let end = start;
    const cursorDay = new Date(start);
    while (cursorDay.getTime() <= target.getTime()) {
      if (!isFreeForLoan(cursorDay)) break;
      end = new Date(cursorDay);
      cursorDay.setDate(cursorDay.getDate() + 1);
    }
    return end;
  }

  function pick(day: Date) {
    setSel((cur) => {
      if (!cur || cur.end) return { start: day, end: null };
      if (day.getTime() < cur.start.getTime()) return { start: day, end: null };
      return { start: cur.start, end: clampEnd(cur.start, day) };
    });
  }

  function inSelection(day: Date): boolean {
    if (!sel) return false;
    const t = day.getTime();
    const s = sel.start.getTime();
    const e = (sel.end ?? sel.start).getTime();
    return t >= s && t <= e;
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
          const dayStart = dayBounds(day)[0];
          // A blocking status hatches out otherwise-free days from today on.
          const isBlocked =
            !!blocked && state.status === 'free' && dayStart.getTime() >= todayStart.getTime();
          const selectable =
            !!onCreateLoan &&
            state.status === 'free' &&
            !isBlocked &&
            dayStart.getTime() >= todayStart.getTime();
          const selected = inSelection(day);
          const title = isBlocked
            ? blocked.reason
            : state.windows.map((w) => w.label).filter(Boolean).join(', ');
          const ring = selected
            ? 'ring-2 ring-inset ring-blue-500 font-semibold'
            : isToday
              ? 'ring-2 ring-inset ring-slate-900 dark:ring-slate-100 font-semibold'
              : undefined;
          const className = clsx(
            'aspect-square rounded flex items-center justify-center text-xs',
            isBlocked ? blockedDayClass : dayClasses[state.status],
            !inMonth && 'opacity-40',
            selectable && 'cursor-pointer hover:ring-2 hover:ring-inset hover:ring-blue-400',
            ring,
          );
          const label = `${day.toLocaleDateString('cs-CZ')} — ${statusLabel(
            isBlocked ? 'blocked' : state.status,
          )}`;
          if (selectable) {
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => pick(day)}
                aria-pressed={selected}
                aria-label={`${day.toLocaleDateString('cs-CZ')} — volné, vybrat`}
                className={className}
              >
                {day.getDate()}
              </button>
            );
          }
          return (
            <div
              key={day.toISOString()}
              role="img"
              aria-label={label}
              title={title || undefined}
              style={isBlocked ? HATCH_STYLE : undefined}
              className={className}
            >
              {day.getDate()}
            </div>
          );
        })}
      </div>

      {onCreateLoan && sel && (
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded border border-blue-200 bg-blue-50 p-2 text-sm dark:border-blue-800 dark:bg-blue-900/30">
          <span className="text-slate-700 dark:text-slate-200">
            {sel.end ? (
              <>
                Termín {sel.start.toLocaleDateString('cs-CZ')} – {sel.end.toLocaleDateString('cs-CZ')}
              </>
            ) : (
              <>Začátek {sel.start.toLocaleDateString('cs-CZ')} — vyber konec (nebo půjč na jeden den)</>
            )}
          </span>
          <span className="flex-1" />
          <Button onClick={() => onCreateLoan(sel.start, sel.end ?? sel.start)}>
            Vytvořit výpůjčku
          </Button>
          <Button variant="ghost" onClick={() => setSel(null)}>
            Zrušit
          </Button>
        </div>
      )}

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
