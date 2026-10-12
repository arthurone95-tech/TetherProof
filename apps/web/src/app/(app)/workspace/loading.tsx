import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

/** The workspace: one form, a tall one. */
export default function WorkspaceLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading the work log</span>
      <SkeletonCard>
        <div className="flex flex-col gap-5">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex flex-col gap-2">
              <Skeleton className="h-3 w-28" />
              <Skeleton className="h-11 w-full rounded-xl" />
            </div>
          ))}
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl sm:w-40" />
        </div>
      </SkeletonCard>
    </div>
  );
}
