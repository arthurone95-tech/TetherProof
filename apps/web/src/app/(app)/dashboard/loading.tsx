import { Skeleton } from '@/components/ui/Skeleton';

/** The worker dashboard: the standing bar, the record summary, and recent work. */
export default function DashboardLoading() {
  return (
    <div className="flex w-full flex-col gap-5 px-2 pt-1 pb-12 sm:px-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your dashboard…</span>

      <div className="flex items-center justify-between px-1">
        <Skeleton className="h-4 w-44" />
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      <Skeleton className="h-24 rounded-2xl" />

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-14" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <Skeleton key={index} className="h-16 rounded-xl" />
        ))}
      </div>
    </div>
  );
}
