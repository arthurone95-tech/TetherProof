import { Skeleton } from '@/components/ui/Skeleton';

/** The settings index: a short list of destinations. */
export default function SettingsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-6" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading settings</span>
      <ul className="flex flex-col gap-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <li
            key={index}
            className="flex items-center gap-3 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm"
          >
            <Skeleton className="h-10 w-10 shrink-0 rounded-xl" />
            <div className="min-w-0 flex-1">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-2 h-3 w-48" />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
