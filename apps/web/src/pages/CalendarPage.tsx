import { useMemo, useState } from 'react';
import { errorMessage } from '../lib/errors.js';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { apiClient, type LoanCalendarAsset } from '../lib/api.js';
import { Button, Input } from '../components/ui.js';
import { useT } from '../i18n/index.js';
import { useDebouncedValue } from '../lib/useDebouncedValue.js';
import { CalendarLegend } from '../components/AvailabilityCalendar.js';
import {
  HATCH_STYLE,
  dayBounds,
  dayState,
  daysInMonth,
  isSameDay,
  monthTitle,
  nonLoanableReason,
  type BusyWindow,
  type DayStatus,
} from '../lib/availability.js';

// In the dense grid free days are left blank so the booked spans stand out;
// only reserved/loaned cells get a fill.
const cellClasses: Record<DayStatus, string> = {
  free: '',
  planned: 'bg-violet-200 dark:bg-violet-800/60',
  active: 'bg-amber-200 dark:bg-amber-700/60',
};

function toWindows(asset: LoanCalendarAsset): BusyWindow[] {
  return asset.windows.map((w) => ({
    start: new Date(w.start),
    end: w.end ? new Date(w.end) : null,
    status: w.status,
    label: w.borrowerName,
  }));
}

export function CalendarPage() {
  const t = useT();
  const today = new Date();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const [search, setSearch] = useState('');
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const [limit, setLimit] = useState(100);

  // "Free in the whole window" filter, evaluated server-side: [from, to) with
  // the `to` day made inclusive.
  const freeRange = useMemo(() => {
    if (!rangeFrom || !rangeTo) return null;
    const from = new Date(rangeFrom);
    const to = new Date(rangeTo);
    to.setDate(to.getDate() + 1);
    if (to.getTime() <= from.getTime()) return null;
    return { from: from.toISOString(), to: to.toISOString() };
  }, [rangeFrom, rangeTo]);

  const debouncedSearch = useDebouncedValue(search);
  const calendar = useQuery({
    queryKey: ['loan-calendar', { search: debouncedSearch, freeRange, limit }],
    queryFn: () =>
      apiClient.loans.calendar({
        q: debouncedSearch.trim() || undefined,
        freeFrom: freeRange?.from,
        freeTo: freeRange?.to,
        limit,
      }),
    placeholderData: keepPreviousData,
  });

  const days = useMemo(() => daysInMonth(cursor.year, cursor.month), [cursor]);

  const rows = useMemo(
    () => (calendar.data?.items ?? []).map((a) => ({ asset: a, windows: toWindows(a) })),
    [calendar.data],
  );
  const total = calendar.data?.total ?? 0;

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">{t.calendar.title}</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label={t.calendar.prevMonth}
          >
            ←
          </button>
          <span className="text-sm font-medium capitalize min-w-36 text-center">
            {monthTitle(cursor.year, cursor.month)}
          </span>
          <button
            type="button"
            onClick={() => shift(1)}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label={t.calendar.nextMonth}
          >
            →
          </button>
          <button
            type="button"
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            {t.calendar.today}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex-1 min-w-[200px] block">
          <span className="text-xs text-slate-500 block mb-0.5">{t.calendar.search}</span>
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t.calendar.searchPlaceholder}
          />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 block mb-0.5">{t.calendar.freeFrom}</span>
          <Input type="date" value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} />
        </label>
        <label className="block">
          <span className="text-xs text-slate-500 block mb-0.5">{t.calendar.rangeTo}</span>
          <Input type="date" value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} />
        </label>
        {(rangeFrom || rangeTo) && (
          <Button
            variant="ghost"
            className="text-xs"
            onClick={() => {
              setRangeFrom('');
              setRangeTo('');
            }}
          >
            {t.calendar.clearRange}
          </Button>
        )}
      </div>

      {freeRange && (
        <p className="text-sm text-slate-500">
          {t.calendar.freeInRange} <span className="font-medium">{total}</span>{' '}
          {t.calendar.assetsCount(total)}.
        </p>
      )}

      {calendar.isLoading && <p className="text-slate-500">{t.calendar.loading}</p>}
      {calendar.error && <p className="text-red-600">{errorMessage(calendar.error)}</p>}

      {calendar.data && rows.length === 0 && (
        <p className="text-sm text-slate-500">{t.calendar.noMatches}</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white dark:bg-slate-800 px-3 py-2 text-left font-medium border-b border-slate-200 dark:border-slate-700">
                  {t.calendar.assetColumn}
                </th>
                {days.map((day) => {
                  const weekend = day.getDay() === 0 || day.getDay() === 6;
                  const isToday = isSameDay(day, today);
                  return (
                    <th
                      key={day.toISOString()}
                      className={clsx(
                        'w-7 min-w-7 py-2 text-center font-medium border-b border-slate-200 dark:border-slate-700',
                        weekend && 'text-slate-400 dark:text-slate-500',
                        isToday && 'bg-slate-100 dark:bg-slate-700',
                      )}
                    >
                      {day.getDate()}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ asset, windows }) => {
                const blockReason = nonLoanableReason(asset.status);
                return (
                  <tr key={asset.id} className="border-b border-slate-100 dark:border-slate-700/50">
                    <th className="sticky left-0 z-10 bg-white dark:bg-slate-800 px-3 py-1.5 text-left font-normal whitespace-nowrap">
                      <Link to={`/a/${encodeURIComponent(asset.code)}`} className="hover:underline">
                        <span className="font-mono text-slate-500 dark:text-slate-400">
                          {asset.code}
                        </span>{' '}
                        {asset.name}
                      </Link>
                      {blockReason && (
                        <span className="ml-2 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] text-slate-600 dark:bg-slate-700 dark:text-slate-300">
                          {blockReason}
                        </span>
                      )}
                    </th>
                    {days.map((day) => {
                      const state = dayState(windows, day);
                      const isToday = isSameDay(day, today);
                      const isBlocked =
                        !!blockReason &&
                        state.status === 'free' &&
                        dayBounds(day)[0].getTime() >= todayStart.getTime();
                      const title = isBlocked
                        ? blockReason
                        : state.windows
                            .map((w) => w.label)
                            .filter(Boolean)
                            .join(', ');
                      return (
                        <td
                          key={day.toISOString()}
                          title={title || undefined}
                          style={isBlocked ? HATCH_STYLE : undefined}
                          className={clsx(
                            'h-7 border-l border-slate-100 dark:border-slate-700/50',
                            cellClasses[state.status],
                            isToday &&
                              state.status === 'free' &&
                              'bg-slate-100 dark:bg-slate-700/40',
                          )}
                        />
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {rows.length < total && (
        <div className="flex items-center gap-3">
          <Button
            variant="secondary"
            disabled={calendar.isFetching}
            onClick={() => setLimit((l) => l + 100)}
          >
            {calendar.isFetching ? t.calendar.loading : t.calendar.loadMore}
          </Button>
          <span className="text-xs text-slate-500">{t.calendar.shownOf(rows.length, total)}</span>
        </div>
      )}

      <CalendarLegend blocked={rows.some((r) => nonLoanableReason(r.asset.status))} />
    </section>
  );
}
