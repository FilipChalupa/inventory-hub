import { Skeleton } from '../../components/ui.js';

/** Placeholder mirroring the detail layout while the asset query loads. */
export function AssetDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-24" />
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-7 w-56" />
          <Skeleton className="h-5 w-20" />
        </div>
        <Skeleton className="h-32 w-32" />
      </div>
      <Skeleton className="h-24 w-full" />
      <Skeleton className="h-40 w-full" />
    </div>
  );
}
