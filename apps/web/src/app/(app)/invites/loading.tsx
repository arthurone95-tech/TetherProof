import { Skeleton, SkeletonCard } from '@/components/ui/Skeleton';

/** The invitation inbox: what is waiting to be answered, then what was. */
export default function InvitesLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your invitations</span>
      {[0, 1].map((card) => (
        <SkeletonCard key={card}>
          <Skeleton className="h-5 w-44" />
          <div className="mt-4 flex flex-col gap-4">
            {[0, 1].map((row) => (
              <div key={row} className="rounded-xl border border-brand-100 p-4">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="mt-3 h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-2/3" />
              </div>
            ))}
          </div>
        </SkeletonCard>
      ))}
    </div>
  );
}
