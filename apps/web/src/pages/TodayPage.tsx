import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../lib/errors.js';
import { Link } from 'react-router-dom';
import { apiClient, type LoanRow, type LoanTodayBucket } from '../lib/api.js';
import type { Asset } from '@inventory-hub/shared';
import { Button, Card, SkeletonList, formatDate } from '../components/ui.js';
import { confirm } from '../components/ConfirmDialog.js';
import { toast } from '../components/Toast.js';
import { useCurrentUser } from '../auth/AuthContext.js';
import { useT, getLocale } from '../i18n/index.js';
import { localeTag } from '../i18n/util.js';

/**
 * Operational "what needs attention today" view: overdue returns, returns due
 * today, and reservations starting today. Buckets are computed server-side so
 * nothing is silently capped.
 */
export function TodayPage() {
  const t = useT();
  const now = new Date();
  const todayQuery = useQuery({
    queryKey: ['loans-today'],
    queryFn: () => apiClient.loans.today(),
  });

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">{t.today.title}</h1>
        <span className="text-sm text-slate-500">
          {now.toLocaleDateString(localeTag(getLocale()))}
        </span>
      </div>

      {todayQuery.isLoading && <SkeletonList rows={3} />}
      {todayQuery.error && <p className="text-red-600">{errorMessage(todayQuery.error)}</p>}

      {todayQuery.data && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <LoanGroup
            title={t.today.overdue}
            tone="danger"
            loans={todayQuery.data.overdue}
            empty={t.today.overdueEmpty}
          />
          <LoanGroup
            title={t.today.dueToday}
            tone="warning"
            loans={todayQuery.data.dueToday}
            empty={t.today.dueTodayEmpty}
          />
          <LoanGroup
            title={t.today.startingToday}
            tone="info"
            loans={todayQuery.data.startingToday}
            empty={t.today.startingTodayEmpty}
          />
        </div>
      )}

      <MyThings />
    </section>
  );
}

/**
 * Self-service panel for the signed-in user: the assets currently assigned to
 * them and their active loans, each with a one-click hand-over / return. The
 * backend authorizes these actions for the owner regardless of role, so this
 * is what a plain `member` uses to give things back.
 */
function MyThings() {
  const t = useT();
  const me = useCurrentUser();
  const qc = useQueryClient();

  const myAssetsQuery = useQuery({
    queryKey: ['my-assets', me?.id],
    queryFn: () => apiClient.assets.list({ assignedToUserId: me!.id, limit: 200 }),
    enabled: !!me,
  });

  const myLoansQuery = useQuery({
    queryKey: ['my-loans', me?.id],
    queryFn: () => apiClient.loans.list({ limit: 200 }),
    enabled: !!me,
    // Keep only started, not-yet-fully-returned loans borrowed by me.
    select: (data): LoanRow[] =>
      data.items.filter(
        (l) =>
          l.borrowerUserId === me!.id && (l.status === 'open' || l.status === 'partially_returned'),
      ),
  });

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['my-assets'] });
    qc.invalidateQueries({ queryKey: ['my-loans'] });
    qc.invalidateQueries({ queryKey: ['loans-today'] });
    qc.invalidateQueries({ queryKey: ['assets'] });
  };

  const handOver = useMutation({
    mutationFn: (code: string) => apiClient.assets.unassign(code),
    onSuccess: () => {
      invalidate();
      toast.success(t.today.handedOver);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  const returnItem = useMutation({
    mutationFn: ({ loanId, itemId }: { loanId: string; itemId: string }) =>
      apiClient.loans.returnItem(loanId, itemId, { returnCondition: 'ok' }),
    onSuccess: () => {
      invalidate();
      toast.success(t.today.itemReturned);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });

  if (!me) return null;

  const assets = myAssetsQuery.data?.items ?? [];
  const loans = myLoansQuery.data ?? [];

  return (
    <div className="space-y-3">
      <h2 className="text-lg font-semibold">{t.today.myThings}</h2>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <h3 className="font-semibold mb-2">
            {t.today.myAssets}
            <span className="ml-2 text-sm font-normal text-slate-400">{assets.length}</span>
          </h3>
          {myAssetsQuery.isLoading ? (
            <SkeletonList rows={2} />
          ) : assets.length === 0 ? (
            <p className="text-sm text-slate-500">{t.today.myAssetsEmpty}</p>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {assets.map((asset) => (
                <MyAssetRow
                  key={asset.code}
                  asset={asset}
                  pending={handOver.isPending}
                  onHandOver={async () => {
                    const ok = await confirm({
                      title: t.today.handOverConfirmTitle,
                      message: t.today.handOverConfirmMessage(asset.code),
                      confirmLabel: t.today.handOver,
                    });
                    if (ok) handOver.mutate(asset.code);
                  }}
                />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <h3 className="font-semibold mb-2">
            {t.today.myLoans}
            <span className="ml-2 text-sm font-normal text-slate-400">{loans.length}</span>
          </h3>
          {myLoansQuery.isLoading ? (
            <SkeletonList rows={2} />
          ) : loans.length === 0 ? (
            <p className="text-sm text-slate-500">{t.today.myLoansEmpty}</p>
          ) : (
            <ul className="space-y-3">
              {loans.map((loan) => (
                <li key={loan.id} className="text-sm">
                  <Link to={`/loans/${loan.id}`} className="font-medium hover:underline">
                    {loan.borrowerName}
                  </Link>
                  {loan.expectedReturnAt && (
                    <span className="ml-2 text-xs text-slate-500">
                      {formatDate(loan.expectedReturnAt)}
                    </span>
                  )}
                  <ul className="mt-1 divide-y divide-slate-200 dark:divide-slate-700">
                    {loan.items
                      .filter((it) => it.returnedAt === null)
                      .map((it) => (
                        <li key={it.id} className="flex items-center justify-between gap-2 py-1.5">
                          <span className="truncate">
                            <span className="font-mono text-xs">{it.assetCode}</span>{' '}
                            <span className="text-slate-500">{it.assetName}</span>
                          </span>
                          <Button
                            variant="secondary"
                            disabled={returnItem.isPending}
                            onClick={async () => {
                              const ok = await confirm({
                                title: t.today.returnItemConfirmTitle,
                                message: t.today.returnItemConfirmMessage(it.assetCode ?? ''),
                                confirmLabel: t.today.returnItem,
                              });
                              if (ok) returnItem.mutate({ loanId: loan.id, itemId: it.id });
                            }}
                          >
                            {t.today.returnItem}
                          </Button>
                        </li>
                      ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MyAssetRow({
  asset,
  pending,
  onHandOver,
}: {
  asset: Asset;
  pending: boolean;
  onHandOver: () => void;
}) {
  const t = useT();
  return (
    <li className="flex items-center justify-between gap-2 py-2 text-sm">
      <Link to={`/a/${asset.code}`} className="truncate hover:underline">
        <span className="font-mono text-xs">{asset.code}</span>{' '}
        <span className="text-slate-500">{asset.name}</span>
      </Link>
      <Button variant="secondary" disabled={pending} onClick={onHandOver}>
        {t.today.handOver}
      </Button>
    </li>
  );
}

const toneStyles = {
  danger: 'text-red-700 dark:text-red-300',
  warning: 'text-amber-700 dark:text-amber-300',
  info: 'text-violet-700 dark:text-violet-300',
} as const;

function LoanGroup({
  title,
  tone,
  loans,
  empty,
}: {
  title: string;
  tone: keyof typeof toneStyles;
  loans: LoanTodayBucket[];
  empty: string;
}) {
  const t = useT();
  return (
    <Card>
      <h2 className={`font-semibold mb-2 ${toneStyles[tone]}`}>
        {title}
        <span className="ml-2 text-sm font-normal text-slate-400">{loans.length}</span>
      </h2>
      {loans.length === 0 ? (
        <p className="text-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="divide-y divide-slate-200 dark:divide-slate-700">
          {loans.map((loan) => (
            <li key={loan.id}>
              <Link
                to={`/loans/${loan.id}`}
                className="flex items-center justify-between gap-2 py-2 text-sm hover:underline"
              >
                <span className="truncate">
                  {loan.borrowerName}
                  <span className="text-xs text-slate-400">
                    {' '}
                    · {t.today.pieces(loan.itemCount)}
                  </span>
                </span>
                <span className="text-xs text-slate-500 whitespace-nowrap">
                  {formatDate(loan.date)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
