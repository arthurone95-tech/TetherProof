'use client';

import { useActionState } from 'react';
import { Scale, ShieldCheck, Undo2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { FormSuccess } from '@/components/ui/FormSuccess';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { decideProofReview } from '@/lib/actions';
import { EMPTY_REVIEW, type ReviewState } from '@/lib/form-state';

/**
 * The two decisions available on a withheld record.
 *
 * Written as what each one *does*, not as approve/reject, because that framing is
 * what made the old system indefensible: one button looked like a routine verdict
 * on a person when it was a heuristic over a self-declared location and a photo
 * that had been through WhatsApp. The copy names the consequence, because the
 * reviewer is deciding someone's income.
 *
 * `upheld` is the only path to `fraud_blocked` anywhere in the system and
 * `overturned` the only path back to `verified`. Neither is reversible from this
 * screen, so neither offers a confirm step: the cost is stated up front instead,
 * which is the cheaper of the two when the action is correct.
 */
export function ProofReviewForm({ proofId }: { proofId: string }) {
  const [state, action] = useActionState(decideProofReview, EMPTY_REVIEW as ReviewState);

  return (
    <form
      action={action}
      className="mt-4 flex flex-col gap-3 border-t border-amber-200 pt-4"
    >
      <input type="hidden" name="proofId" value={proofId} />

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
      <FormSuccess when={state.done === true}>
        {state.outcome === 'overturned'
          ? 'Restored. This record counts toward the worker again.'
          : 'Decision recorded. The record stays withheld.'}
      </FormSuccess>

      <div className="flex flex-wrap gap-2">
        <SubmitButton
          name="outcome"
          value="overturned"
          variant="primary"
          className="min-h-11 w-auto gap-2 px-4 text-sm"
        >
          <Undo2 aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          Restore the record
        </SubmitButton>
        <SubmitButton
          name="outcome"
          value="upheld"
          variant="danger"
          className="min-h-11 w-auto gap-2 px-4 text-sm"
        >
          <ShieldCheck aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          Uphold the block
        </SubmitButton>
      </div>

      <p className="flex items-start gap-1.5 text-xs text-ink-600">
        <Scale aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
        Either decision is recorded against your account with the time, and cannot be
        undone from this screen. Restoring puts the work back on the worker&rsquo;s record.
      </p>
    </form>
  );
}