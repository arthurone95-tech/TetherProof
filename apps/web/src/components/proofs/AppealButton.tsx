'use client';

import { useActionState } from 'react';
import { Scale } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { appealProof } from '@/lib/actions';
import { EMPTY_APPEAL, type AppealState } from '@/lib/form-state';

/**
 * A worker's request to have a withheld record looked at again.
 *
 * Deliberately not a text field. An appeal is not an argument — the worker is
 * not asked to explain themselves to a stranger, and an empty box next to a
 * button invites either a perfunctory "please" or a paragraph nobody will read.
 * What the reviewer needs is the evidence and the signals, both of which are
 * already on the record.
 *
 * It also cannot promise anything. The copy says the record is queued, not that
 * it will be restored, because it may not be: an upheld decision stands, and the
 * appeal existing is not the same as the appeal succeeding.
 */
export function AppealButton({ proofId }: { proofId: string }) {
  const [state, formAction, pending] = useActionState(appealProof, EMPTY_APPEAL as AppealState);

  const done = state.done === true;
  const asked = state.reviewStatus === 'appealed';

  return (
    <form action={formAction} className="mt-3">
      <input type="hidden" name="proofId" value={proofId} />
      <button
        type="submit"
        disabled={pending || done || asked}
        className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-amber-700 px-4 text-sm font-semibold text-amber-800 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
      >
        <Scale aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
        {done ? 'Asked for review' : pending ? 'Asking…' : 'Ask for this to be reviewed'}
      </button>
      {asked && !done ? (
        <p className="mt-2 text-sm text-amber-900">You have already asked for this to be reviewed.</p>
      ) : null}
      {state.error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
    </form>
  );
}
