import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import clsx from 'clsx';
import { apiClient, type LoanCalendarAsset } from '../lib/api.js';
import { Input } from '../components/ui.js';
import { CalendarLegend } from '../components/AvailabilityCalendar.js';
import {
  dayState,
  daysInMonth,
  isSameDay,
  monthTitle,
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
  const today = new Date();
  const [cursor, setCursor] = useState(() => ({
    year: today.getFullYear(),
    month: today.getMonth(),
  }));
  const [search, setSearch] = useState('');

  const calendar = useQuery({
    queryKey: ['loan-calendar'],
    queryFn: () => apiClient.loans.calendar(),
  });

  const days = useMemo(() => daysInMonth(cursor.year, cursor.month), [cursor]);

  const rows = useMemo(() => {
    const items = calendar.data?.items ?? [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? items.filter(
          (a) => a.code.toLowerCase().includes(q) || a.name.toLowerCase().includes(q),
        )
      : items;
    return filtered.map((a) => ({ asset: a, windows: toWindows(a) }));
  }, [calendar.data, search]);

  function shift(delta: number) {
    setCursor((c) => {
      const d = new Date(c.year, c.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Kalendář dostupnosti</h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => shift(-1)}
            className="rounded px-2 py-1 text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
            aria-label="Předchozí měsíc"
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
            aria-label="Další měsíc"
          >
            →
          </button>
          <button
            type="button"
            onClick={() => setCursor({ year: today.getFullYear(), month: today.getMonth() })}
            className="rounded px-2 py-1 text-xs text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-700"
          >
            Dnes
          </button>
        </div>
      </div>

      <Input
        type="search"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Hledat asset podle kódu / názvu…"
        className="max-w-sm"
      />

      {calendar.isLoading && <p className="text-slate-500">Načítám…</p>}
      {calendar.error && (
        <p className="text-red-600">{(calendar.error as Error).message}</p>
      )}

      {calendar.data && rows.length === 0 && (
        <p className="text-sm text-slate-500">Žádné assety neodpovídají hledání.</p>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto rounded border border-slate-200 bg-white dark:bg-slate-800 dark:border-slate-700">
          <table className="border-collapse text-xs">
            <thead>
              <tr>
                <th className="sticky left-0 z-10 bg-white dark:bg-slate-800 px-3 py-2 text-left font-medium border-b border-slate-200 dark:border-slate-700">
                  Asset
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
              {rows.map(({ asset, windows }) => (
                <tr key={asset.id} className="border-b border-slate-100 dark:border-slate-700/50">
                  <th className="sticky left-0 z-10 bg-white dark:bg-slate-800 px-3 py-1.5 text-left font-normal whitespace-nowrap">
                    <Link
                      to={`/a/${encodeURIComponent(asset.code)}`}
                      className="hover:underline"
                    >
                      <span className="font-mono text-slate-500 dark:text-slate-400">
                        {asset.code}
                      </span>{' '}
                      {asset.name}
                    </Link>
                  </th>
                  {days.map((day) => {
                    const state = dayState(windows, day);
                    const isToday = isSameDay(day, today);
                    const title = state.windows.map((w) => w.label).filter(Boolean).join(', ');
                    return (
                      <td
                        key={day.toISOString()}
                        title={title || undefined}
                        className={clsx(
                          'h-7 border-l border-slate-100 dark:border-slate-700/50',
                          cellClasses[state.status],
                          isToday && state.status === 'free' && 'bg-slate-100 dark:bg-slate-700/40',
                        )}
                      />
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <CalendarLegend />
    </section>
  );
}
