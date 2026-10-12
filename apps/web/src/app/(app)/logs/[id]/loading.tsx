import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

/** One log entry: its media, the words, and — while editable — the form. */
export default function LogDetailLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the log entry</span>
      <SkeletonCard>
        <div className="flex items-center justify-between gap-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-20 rounded-full" />
        </div>
        <Skeleton className="mt-4 aspect-video w-full rounded-xl" />
        <div className="mt-4 flex flex-col gap-2">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton className="h-4 w-28" />
        <div className="mt-4 flex flex-col gap-4">
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-11 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl sm:w-36" />
        </div>
      </SkeletonCard>
    </div>
  );
}
