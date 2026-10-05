/**
 * A short confirmation that a form submitted successfully.
 *
 * `role="status"` so it is announced when it appears rather than sitting silently at
 * the bottom of a form the user has scrolled past. It is a message and not a change
 * to the button, which stays usable: a form that disables itself after one save looks
 * finished for good.
 */
export function FormSuccess({ when, children }: { when: boolean; children: React.ReactNode }) {
  if (!when) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-700"
    >
      <span aria-hidden="true">✓</span>
      {children}
    </p>
  );
}