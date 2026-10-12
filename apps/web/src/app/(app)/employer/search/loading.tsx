import { Skeleton } from '@/components/ui/Skeleton';

/** The candidate search: the bar in, the result rows out. */
export default function SearchLoading() {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Searching candidates</span>
      <Skeleton className="h-12 w-full rounded-xl" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-5 w-28 rounded-md" />
        <Skeleton className="h-[200px] w-full rounded-2xl" />
      </div>
    </div>
  );
}