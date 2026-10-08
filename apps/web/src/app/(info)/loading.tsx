/**
 * The fallback while a public page (About, Help, Terms, Privacy) renders.
 *
 * Same reasoning as the app's loading view: the navigation is already
 * client-side, so the only wait is the server's — and a few pale blocks say
 * "coming" where a blank screen says "stalled".
 */
export default function InfoLoading() {
  return (
    <div className="flex animate-pulse flex-col gap-8" aria-busy="true">
      <div className="h-8 w-44 rounded-lg bg-brand-100" />
      <div className="h-4 w-full rounded bg-brand-50" />
      <div className="h-4 w-5/6 rounded bg-brand-50" />
      <div className="h-4 w-2/3 rounded bg-brand-50" />
      <div className="mt-4 h-6 w-52 rounded bg-brand-100" />
      <div className="h-4 w-full rounded bg-brand-50" />
      <div className="h-4 w-4/6 rounded bg-brand-50" />
    </div>
  );
}
