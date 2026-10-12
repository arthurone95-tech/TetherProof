import { Skeleton } from '@/components/ui/Skeleton';

/** The employer dashboard: the greeting, the verification banner, and the metrics. */
export default function EmployerDashboardLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the employer dashboard</span>

      <div className="flex flex-col gap-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>

      <Skeleton className="h-20 w-full rounded-2xl" />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-28 rounded-2xl" />
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between px-1">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-3 w-28" />
        </div>
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    </div>
  );
}
