import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

/** The worker's privacy choices, as a few grouped controls. */
export default function PrivacyLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading privacy settings</span>
      <SkeletonCard>
        <div className="flex flex-col gap-5">
          {[0, 1, 2].map((group) => (
            <div key={group} className="rounded-xl border border-brand-100 p-4">
              <Skeleton className="h-4 w-36" />
              <div className="mt-3 flex items-start gap-3">
                <Skeleton className="mt-0.5 h-4 w-4 shrink-0 rounded" />
                <div className="min-w-0 flex-1">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="mt-2 h-3 w-full" />
                </div>
              </div>
            </div>
          ))}
          <Skeleton className="h-12 w-full rounded-xl sm:w-28" />
        </div>
      </SkeletonCard>
    </div>
  );
}
