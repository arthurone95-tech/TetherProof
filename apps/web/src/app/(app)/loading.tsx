/**
 * Shown while a signed-in page is still talking to the API.
 *
 * A skeleton rather than a spinner because the shape of what is coming is the
 * useful part: it tells somebody the page is not empty, only unfinished, so they
 * do not press again half a second in and start the whole request over.
 *
 * `role="status"` rather than a bare div, so the wait is announced to a screen
 * reader that has no visual change to notice.
 */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <div className="flex flex-col gap-3">
        <div className="h-8 w-48 animate-pulse rounded-lg bg-brand-100" />
        <div className="h-5 w-80 max-w-full animate-pulse rounded-md bg-brand-100" />
      </div>
      <div className="h-64 w-full animate-pulse rounded-2xl bg-brand-100" />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="h-40 animate-pulse rounded-2xl bg-brand-100" />
        <div className="h-40 animate-pulse rounded-2xl bg-brand-100" />
      </div>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
