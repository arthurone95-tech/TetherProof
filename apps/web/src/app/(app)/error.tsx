'use client';

/**
 * A failed signed-in screen.
 *
 * The error's own message is deliberately not rendered. An unexpected failure
 * here has most often described a database, a connection, or a stack frame, and
 * putting that in front of a member is both useless to them and a small leak of
 * how the thing is built. What they need is that it was not their doing and that
 * there is one obvious next step, so that is what this says.
 *
 * The shell stays out of it: this replaces only the page's own content, and the
 * navigation above it is still there to reach somewhere else.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  void error;

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 rounded-2xl border border-brand-100 bg-white p-6 shadow-sm">
      <h1 className="text-xl font-bold text-ink-900">That page did not load</h1>
      <p className="text-ink-600">
        Nothing you entered was lost, and nothing was saved either. Trying again usually works; if
        it does not, the problem is on our side.
      </p>
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          onClick={() => reset()}
          className="inline-flex min-h-12 items-center rounded-xl bg-brand-600 px-5 text-sm font-semibold text-white transition-colors hover:bg-brand-700"
        >
          Try again
        </button>
      </div>
    </div>
  );
}
