import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

/** A member's profile: the details card, then whatever the role proves. */
export default function ProfileLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your profile</span>
      <SkeletonCard>
        <div className="flex items-center gap-4">
          <Skeleton className="h-16 w-16 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-3 w-32" />
          </div>
        </div>
        <Skeleton className="mt-5 h-11 w-full rounded-xl sm:w-32" />
      </SkeletonCard>
      <SkeletonCard>
        <Skeleton className="h-4 w-32" />
        <div className="mt-4 flex flex-col gap-3">
          <Skeleton className="h-12 w-full rounded-xl" />
          <Skeleton className="h-12 w-full rounded-xl" />
        </div>
      </SkeletonCard>
    </div>
  );
}
