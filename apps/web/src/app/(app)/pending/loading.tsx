import { SkeletonCard } from '@/components/ui/Skeleton';

/** The placeholder for a role whose module is not built. */
export default function PendingLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <SkeletonCard className="h-40" />
    </div>
  );
}
