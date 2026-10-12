import { Skeleton } from '@/components/ui/Skeleton';

/** The logbook: a stack of work rows, each a thumbnail and its verdict. */
export default function LogsLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your logs</span>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="flex items-center gap-3 rounded-2xl border border-brand-100 bg-white p-4">
            <Skeleton className="h-14 w-14 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-3/4" />
              <Skeleton className="mt-2 h-3 w-24" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
