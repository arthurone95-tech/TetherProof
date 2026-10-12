import { Skeleton } from '@/components/ui/Skeleton';

/** The notification feed: the unread line and its button, then entries. */
export default function NotificationsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading your notifications</span>
      <div className="flex items-center justify-between gap-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <li key={index} className="flex items-start gap-3 rounded-2xl border border-brand-100 bg-white p-4">
            <Skeleton className="h-9 w-9 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
