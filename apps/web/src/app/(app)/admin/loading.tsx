import { Skeleton } from '@/components/ui/Skeleton';

/** The admin approval queue: a stack of employer rows. */
export default function AdminLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the approval queue</span>
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-3 w-72 max-w-full" />
      </div>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="rounded-2xl border border-brand-100 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-6 w-20 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-3 w-2/3" />
            <Skeleton className="mt-4 h-11 w-full rounded-xl sm:w-40" />
          </li>
        ))}
      </ul>
    </div>
  );
}
