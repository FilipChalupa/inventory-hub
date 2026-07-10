import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiClient, type DashboardStats } from '../lib/api.js';
import { errorMessage } from '../lib/errors.js';
import { Card, SkeletonList } from '../components/ui.js';
import { useT } from '../i18n/index.js';

export function DashboardPage() {
  const t = useT();
  const { data, isLoading, error } = useQuery({
    queryKey: ['stats'],
    queryFn: () => apiClient.stats.get(),
  });

  return (
    <section>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">{t.dashboard.title}</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">{t.dashboard.subtitle}</p>
      </div>

      {isLoading && <SkeletonList />}
      {error && <p className="text-red-600 dark:text-red-400">{errorMessage(error)}</p>}

      {data && <DashboardContent stats={data} />}
    </section>
  );
}

function DashboardContent({ stats }: { stats: DashboardStats }) {
  const t = useT();

  if (stats.totalActive === 0) {
    return (
      <Card>
        <p className="text-sm text-slate-600 dark:text-slate-300">{t.dashboard.empty}</p>
      </Card>
    );
  }

  return (
    <div className="space-y-8">
      {/* Stat tiles */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Tile
          label={t.dashboard.totalActive}
          value={stats.totalActive}
          to="/assets"
          accent="slate"
        />
        <Tile label={t.dashboard.onLoan} value={stats.loans.active} to="/loans" accent="amber" />
        <Tile
          label={t.dashboard.overdue}
          value={stats.loans.overdue}
          to="/loans?status=overdue"
          accent="red"
        />
        <Tile
          label={t.dashboard.inRepair}
          value={stats.inRepair}
          to="/assets?status=in_repair"
          accent="orange"
        />
        <Tile
          label={t.dashboard.planned}
          value={stats.loans.planned}
          to="/loans?status=planned"
          accent="violet"
        />
      </div>

      {/* Breakdown bar charts */}
      <div className="grid gap-4 lg:grid-cols-3">
        <BarChart
          title={t.dashboard.byStatus}
          rows={stats.byStatus
            .filter((s) => s.count > 0)
            .map((s) => ({
              key: s.status,
              label: t.assetStatuses[s.status],
              count: s.count,
              to: `/assets?status=${s.status}`,
            }))}
        />
        <BarChart
          title={t.dashboard.byType}
          rows={stats.byType.map((row) => ({
            key: row.typeId ?? '__none__',
            label: row.typeId ? row.typeName : t.dashboard.noType,
            count: row.count,
            to: row.typeId ? `/assets?typeId=${row.typeId}` : undefined,
          }))}
        />
        <BarChart
          title={t.dashboard.byLocation}
          rows={stats.byLocation.map((row) => ({
            key: row.locationId,
            label: row.locationName,
            count: row.count,
            to: `/assets?locationId=${row.locationId}`,
          }))}
        />
      </div>
    </div>
  );
}

type Accent = 'slate' | 'amber' | 'red' | 'orange' | 'violet';

const accentText: Record<Accent, string> = {
  slate: 'text-slate-900 dark:text-slate-100',
  amber: 'text-amber-600 dark:text-amber-400',
  red: 'text-red-600 dark:text-red-400',
  orange: 'text-orange-600 dark:text-orange-400',
  violet: 'text-violet-600 dark:text-violet-400',
};

function Tile({
  label,
  value,
  to,
  accent,
}: {
  label: string;
  value: number;
  to?: string;
  accent: Accent;
}) {
  const inner = (
    <>
      <div className={`text-3xl font-bold tabular-nums ${accentText[accent]}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
    </>
  );
  const className =
    'block rounded border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800';
  if (to) {
    return (
      <Link
        to={to}
        className={`${className} transition-colors hover:border-slate-300 hover:bg-slate-50 dark:hover:border-slate-600 dark:hover:bg-slate-700/50`}
      >
        {inner}
      </Link>
    );
  }
  return <div className={className}>{inner}</div>;
}

type BarRow = { key: string; label: string; count: number; to?: string };

function BarChart({ title, rows }: { title: string; rows: BarRow[] }) {
  const t = useT();
  const max = Math.max(1, ...rows.map((r) => r.count));

  return (
    <Card>
      <h2 className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</h2>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400 dark:text-slate-500">{t.dashboard.noData}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.key}>
              <Bar label={row.label} count={row.count} pct={(row.count / max) * 100} to={row.to} />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

function Bar({
  label,
  count,
  pct,
  to,
}: {
  label: string;
  count: number;
  pct: number;
  to?: string;
}) {
  const t = useT();
  const content = (
    <>
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <span className="truncate text-sm text-slate-700 dark:text-slate-200">{label}</span>
        <span className="shrink-0 text-xs tabular-nums text-slate-500 dark:text-slate-400">
          {t.dashboard.pieces(count)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded bg-slate-100 dark:bg-slate-700">
        <div
          className="h-full rounded bg-blue-500 dark:bg-blue-400"
          style={{ width: `${Math.max(pct, 3)}%` }}
        />
      </div>
    </>
  );
  if (to) {
    return (
      <Link to={to} className="block rounded p-1 -m-1 hover:bg-slate-50 dark:hover:bg-slate-700/40">
        {content}
      </Link>
    );
  }
  return <div>{content}</div>;
}
