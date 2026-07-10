import { useMemo, useState } from 'react';
import { errorMessage } from '../lib/errors.js';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { apiClient } from '../lib/api.js';
import { useT } from '../i18n/index.js';
import { weekdayLabels, monthGridDays, monthGridRange, monthTitle } from '../lib/availability.js';

type Tone = 'planned' | 'open' | 'overdue';

type Bar = {
  loanId: string;
  borrowerName: string;
  itemCount: number;
  tone: Tone;
  startCol: number;
  span: number;
  roundedLeft: boolean;
  roundedRight: boolean;
  lane: number;
};

const toneClass: Record<Tone, string> = {
  planned: 'bg-violet-200 text-violet-900 dark:bg-violet-800/70 dark:text-violet-100',
  open: 'bg-amber-200 text-amber-900 dark:bg-amber-700/70 dark:text-amber-100',
  overdue: 'bg-red-300 text-red-900 dark:bg-red-800/80 dark:text-red-100',
};

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const dayDiff = (a: Date, b: Date) =>
  Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 86_400_000);

/**
 * Loan-centric month calendar drawing each loan as a continuous bar across
 * every day it touches (start → return), stacked into lanes so overlapping
 * loans don't collide. Overdue loans are red; click a bar to open the loan.
 */
export function LoansCalendar() {
  const t = useT();
  const today = new Date();
  const todayStart = startOfDay(today);
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));

  const [from, to] = useMemo(() => monthGridRange(cursor.year, cursor.month), [cursor]);
  const grid = useMemo(() => monthGridDays(cursor.year, cursor.month), [cursor]);
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < grid.length; i += 7) out.push(grid.slice(i, i + 7));
    return out;
  }, [grid]);
  const gridEndDay = startOfDay(grid[grid.length - 1]!);

  const schedule = useQuery({
    queryKey: ['loan-schedule', from.toISOString(), to.toISOString()],
    queryFn: () => apiClient.loans.schedule({ from: from.toISOString(), to: to.toISOString() }),
  });

  // Normalize each loan to an inclusive [startDay, endDay] span. Open-ended
  // loans (no return date) run to the end of the visible grid.
  const spans = useMemo(() => {
    return (schedule.data?.items ?? []).map((l) => {
      const startDay = startOfDay(new Date(l.start));
      const hasEnd = !!l.end;
      const endDay = hasEnd ? startOfDay(new Date(l.end!)) : gridEndDay;
      const overdue = l.status !== 'planned' && hasEnd && endDay.getTime() < todayStart.getTime();
      const tone: Tone = overdue ? 'overdue' : l.status === 'planned' ? 'planned' : 'open';
      return { loan: l, startDay, endDay, hasEnd, tone };
    });
  }, [schedule.data, gridEndDay, todayStart]);

  // Slice each span into per-week bar segments and assign non-overlapping lanes.
  const barsByWeek = useMemo<Bar[][]>(() => {
    return weeks.map((week) => {
      const week0 = startOfDay(week[0]!);
      const week6 = startOfDay(week[6]!);
      const segs = spans
        .filter((s) => s.startDay <= week6 && s.endDay >= week0)
        .map((s) => {
          const startCol = Math.max(0, dayDiff(s.startDay, week0));
          const endCol = Math.min(6, dayDiff(s.endDay, week0));
          return {
            loanId: s.loan.id,
            borrowerName: s.loan.borrowerName,
            itemCount: s.loan.itemCount,
            tone: s.tone,
            startCol,
            span: endCol - startCol + 1,
            roundedLeft: s.startDay >= week0,
            roundedRight: s.hasEnd && s.endDay <= week6,
            startKey: s.startDay.getTime(),
          };
        })
        .sort((a, b) => a.startCol - b.startCol || a.startKey - b.startKey);

      const laneEnds: number[] = [];
      return segs.map((s): Bar => {
        let lane = laneEnds.findIndex((end) => end < s.startCol);
        if (lane === -1) {
          lane = laneEnds.length;
          laneEnds.push(s.startCol + s.span - 1);
        } else {
          laneEnds[lane] = s.startCol + s.span - 1;
        }
        return { ...s, lane };
      });
    });
  }, [weeks, spans]);

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
            aria-label={t.loansCalendar.prevMonth}
          >
            ←
          </button>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label={t.loansCalendar.nextMonth}
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
          {t.loansCalendar.today}
        </button>
      </div>

      {schedule.error && (
        <p className="text-sm text-red-600 mb-2">{errorMessage(schedule.error)}</p>
      )}

      <div className="rounded border border-slate-200 dark:border-slate-700 overflow-hidden">
        <div className="grid grid-cols-7 border-b border-slate-200 dark:border-slate-700">
          {weekdayLabels().map((label) => (
            <div
              key={label}
              className="text-center text-xs font-medium text-slate-400 dark:text-slate-500 py-1"
            >
              {label}
            </div>
          ))}
        </div>
        {weeks.map((week, wi) => (
          <div
            key={wi}
            className={clsx(
              'grid grid-cols-7 gap-px',
              wi > 0 && 'border-t border-slate-200 dark:border-slate-700',
            )}
            style={{ gridAutoRows: 'min-content' }}
          >
            {week.map((day, col) => {
              const inMonth = day.getMonth() === cursor.month;
              const isToday =
                day.getFullYear() === today.getFullYear() &&
                day.getMonth() === today.getMonth() &&
                day.getDate() === today.getDate();
              const weekend = day.getDay() === 0 || day.getDay() === 6;
              return (
                <div
                  key={day.toISOString()}
                  className={clsx(
                    'min-h-16 px-1 pt-1',
                    !inMonth && 'bg-slate-50 dark:bg-slate-800/40',
                    weekend && inMonth && 'bg-slate-50/60 dark:bg-slate-800/20',
                  )}
                  style={{ gridColumn: col + 1, gridRow: 1 }}
                >
                  <span
                    className={clsx(
                      'inline-block text-xs px-1 rounded',
                      inMonth
                        ? 'text-slate-500 dark:text-slate-400'
                        : 'text-slate-300 dark:text-slate-600',
                      isToday &&
                        'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold',
                    )}
                  >
                    {day.getDate()}
                  </span>
                </div>
              );
            })}
            {barsByWeek[wi]!.map((bar, bi) => (
              <Link
                key={`${bar.loanId}-${bi}`}
                to={`/loans/${bar.loanId}`}
                title={t.loansCalendar.barTitle(bar.borrowerName, bar.itemCount)}
                style={{
                  gridColumn: `${bar.startCol + 1} / span ${bar.span}`,
                  gridRow: bar.lane + 2,
                }}
                className={clsx(
                  'mx-0.5 mb-0.5 truncate px-1 text-[11px] leading-5 hover:opacity-80',
                  toneClass[bar.tone],
                  bar.roundedLeft ? 'rounded-l' : 'rounded-l-none',
                  bar.roundedRight ? 'rounded-r' : 'rounded-r-none',
                )}
              >
                {bar.roundedLeft ? '' : '‹ '}
                {bar.borrowerName}
                {!bar.roundedRight && ' ›'}
              </Link>
            ))}
          </div>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400">
        <LegendItem tone="planned" label={t.loansCalendar.legendReserved} />
        <LegendItem tone="open" label={t.loansCalendar.legendLoaned} />
        <LegendItem tone="overdue" label={t.loansCalendar.legendOverdue} />
      </div>
    </div>
  );
}

function LegendItem({ tone, label }: { tone: Tone; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={clsx('inline-block w-3 h-3 rounded', toneClass[tone])} />
      {label}
    </span>
  );
}
