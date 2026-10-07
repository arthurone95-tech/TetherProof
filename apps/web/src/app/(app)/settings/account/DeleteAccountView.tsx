'use client';

import { useEffect, useRef, useState } from 'react';
import { deleteAccount } from '@/lib/actions';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SubmitButton } from '@/components/ui/SubmitButton';

/**
 * The one place a member deletes their own account.
 *
 * The settings page leads with the action, not the essay. What deletion actually
 * means is held back until the button is pressed, because a wall of text before
 * the choice does not help somebody decide — it just makes the section feel like
 * a lecture. The explanation lives in the confirmation sheet, where it answers
 * the question the button has just raised.
 *
 * Confirmation is a second tap rather than a checkbox. A checkbox is one tap past
 * the button, so it tests willingness rather than intent, and the cost of a
 * mis-tapped irreversible deletion is somebody's entire record. The sheet also
 * keeps the "Keep my account" escape on the confirm screen instead of parked on
 * the page: it belongs where the decision is being made, not on a calm screen.
 */
export function DeleteAccountView() {
  const [confirming, setConfirming] = useState(false);

  return (
    <Card title="Delete your account">
      <p className="text-sm text-ink-600">
        Removes your account and profile from TetherProof. This cannot be undone.
      </p>
      <div className="mt-5">
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Delete my account
        </Button>
      </div>

      {confirming ? <ConfirmSheet onClose={() => setConfirming(false)} /> : null}
    </Card>
  );
}

/**
 * The confirmation itself: a sheet on a phone, a centred dialog on a wider
 * screen, with the short version of what deletion does and the two ways out.
 */
function ConfirmSheet({ onClose }: { onClose: () => void }) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // The safe action gets the focus first, so a stray Enter cannot delete an
    // account by accident. Escape and an overlay tap close without deleting.
    cancelRef.current?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKeyDown);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-ink-900/40" onClick={onClose} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-account-title"
        className="relative w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl md:rounded-2xl"
      >
        <h2 id="delete-account-title" className="text-lg font-semibold text-ink-900">
          Delete your account?
        </h2>

        <div className="mt-2 space-y-2 text-sm text-ink-600">
          <p>Your account and your profile are removed right away.</p>
          <p>
            The work you logged stays on the platform, with your name and everything that
            identifies you taken off it, because proof counts are shared.
          </p>
          <p className="font-semibold text-ink-900">There is no way to get the account back.</p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row-reverse sm:justify-start">
          <form action={deleteAccount}>
            <SubmitButton variant="danger" pendingLabel="Deleting…">
              Delete my account
            </SubmitButton>
          </form>
          <button
            ref={cancelRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-12 w-full items-center justify-center rounded-xl border border-brand-600 px-6 text-base font-semibold text-brand-700 transition-colors hover:bg-brand-50 sm:w-auto"
          >
            Keep my account
          </button>
        </div>
      </div>
    </div>
  );
}