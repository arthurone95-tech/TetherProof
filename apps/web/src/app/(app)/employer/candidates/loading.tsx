import { Skeleton } from '@/components/ui/Skeleton';

/** The people screen: the two-tab switcher and the list under it. */
export default function CandidatesLoading() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading people</span>
      <Skeleton className="h-12 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
      <Skeleton className="h-40 w-full rounded-2xl" />
    </div>
  );
}
