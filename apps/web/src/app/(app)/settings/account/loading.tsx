import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

/** The account screen: one destructive action. */
export default function AccountSettingsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading account settings</span>
      <SkeletonCard>
        <Skeleton className="h-5 w-40" />
        <Skeleton className="mt-3 h-3 w-full" />
        <Skeleton className="mt-2 h-3 w-2/3" />
        <Skeleton className="mt-5 h-12 w-full rounded-xl sm:w-44" />
      </SkeletonCard>
    </div>
  );
}
