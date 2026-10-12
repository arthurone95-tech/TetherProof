import { Skeleton } from '@/components/ui/Skeleton';

/**
 * The safety net while a signed-in page resolves.
 *
 * Every real route now has a skeleton shaped like itself, so this is only what
 * remains for a path without one (a page added before its loading state, or the
 * group's own index). It deliberately shows no more than a header line and two
 * generic cards: a route that had a specific shape would rather show that, and
 * this is the honest shape of "something is coming".
 */
export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-10 w-36 rounded-xl" />
      <Skeleton className="h-20 w-full rounded-2xl" />
      <Skeleton className="h-48 w-full rounded-2xl" />
    </div>
  );
}
