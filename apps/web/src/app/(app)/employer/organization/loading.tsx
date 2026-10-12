import { Skeleton } from '@/components/ui/Skeleton';

/** The organization: its verification state, then the details behind it. */
export default function OrganizationLoading() {
  return (
    <div className="flex flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your organization</span>

      <div className="flex items-start gap-3 rounded-2xl bg-brand-50 p-4">
        <Skeleton className="h-5 w-5 shrink-0 rounded-full" />
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="mt-2 h-3 w-full" />
          <Skeleton className="mt-2 h-3 w-2/3" />
        </div>
      </div>

      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}
