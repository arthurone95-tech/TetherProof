'use client';

import { useFormStatus } from 'react-dom';

/**
 * The sign-out control in the header.
 *
 * A button of its own rather than `SubmitButton`, because the shared button
 * carries full-width and 56px-tall defaults that are right for a form and wrong
 * for a bar the top of every page shares. Everything else — reporting its own
 * pending state, staying disabled while the session is being cleared — is the
 * same, and the wording is a sentence rather than a spinner nobody reads.
 */
export function SignOutButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="inline-flex min-h-9 items-center rounded-lg border border-brand-600 px-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60"
    >
      {pending ? 'Signing out…' : 'Sign out'}
    </button>
  );
}
