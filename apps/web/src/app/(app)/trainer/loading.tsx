/**
 * Shown while an institution page loads.
 *
 * Every page under `/trainer` fetches on the server — roster, overview, issuer, demand —
 * and none of them was wrapped in a Suspense boundary. Without one, the App Router holds
 * the whole route transition open until the slowest of those resolves, so the tab looks
 * inert: the first click registers, nothing appears to happen, and people click again.
 *
 * The second click was not fixing anything. It was the first navigation finally landing.
 *
 * This is the standard Next.js answer and it does not change any data path: the fetch still
 * happens on the server, authorisation is unchanged, and the page still renders the same
 * content. What changes is that the frame is replaced immediately with something that says
 * "working" instead of nothing at all.
 *
 * The skeleton mirrors the shape of a page with a heading and a few rows, so the content
 * does not visibly jump when it arrives.
 */
export default function TrainerLoading() {
  return (
    <div className="flex flex-col gap-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Loading…</span>

      <div className="rounded-2xl border border-brand-200 bg-brand-50/40 p-4 shadow-sm">
        <div className="h-5 w-32 rounded bg-brand-100" />
        <div className="mt-2 h-3 w-64 max-w-full rounded bg-brand-100/70" />
        <div className="mt-4 h-11 w-40 rounded-xl bg-white shadow-sm" />
      </div>

      <div className="flex flex-col gap-2">
        {[0, 1, 2].map((row) => (
          <div key={row} className="h-16 animate-pulse rounded-xl border border-brand-100 bg-white" />
        ))}
      </div>
    </div>
  );
}