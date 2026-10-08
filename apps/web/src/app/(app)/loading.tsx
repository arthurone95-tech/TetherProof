/**
 * The fallback while a signed-in page's server render is still in flight.
 *
 * Navigation inside the app is client-side — the document never reloads — but
 * the page's data still has to be fetched server-side, and without a fallback
 * that wait is a blank stretch of white that reads as the app stalling. This
 * skeleton keeps the shell (header, tabs) exactly where it is and shows the
 * shape of what is coming: a line, a couple of cards. It is the same view a
 * member already recognises, just unfilled, so the page resolving feels like
 * text arriving rather than a screen replacing another screen.
 */
export default function AppLoading() {
  return (
    <div className="mx-auto flex w-full max-w-5xl animate-pulse flex-col gap-6" aria-busy="true">
      <div className="h-12 w-36 rounded-xl bg-brand-100" />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="h-20 rounded-2xl border border-brand-100 bg-white" />
        <div className="h-20 rounded-2xl border border-brand-100 bg-white" />
        <div className="h-20 rounded-2xl border border-brand-100 bg-white" />
        <div className="h-20 rounded-2xl border border-brand-100 bg-white" />
      </div>
      <div className="h-48 rounded-2xl border border-brand-100 bg-white" />
      <div className="h-48 rounded-2xl border border-brand-100 bg-white" />
    </div>
  );
}
