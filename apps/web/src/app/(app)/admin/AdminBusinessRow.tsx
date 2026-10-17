'use client';

import { useActionState } from 'react';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { decideBusinessApproval } from '@/lib/actions';
import { EMPTY_BUSINESS } from '@/lib/form-state';

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * One business in the administrator's queue.
 *
 * The decision is recorded on the business and the owner's `employer` capability is
 * granted or taken in the same call, so an approved business can never be one nobody can
 * hire through, and a rejected one can never leave hiring rights behind. That pairing is
 * in `capabilities/businesses.ts` rather than here, because the rule has to hold however
 * the route is reached.
 *
 * `pending` is offered as a third option deliberately: a mistaken decision should be
 * put back in the queue rather than being final by accident, and the owner's capability
 * follows the record rather than the other way round.
 */
export function AdminBusinessRow({
  business,
}: {
  business: {
    id: string;
    name: string;
    ownerName: string | null;
    status: 'pending' | 'approved' | 'rejected';
    createdAt: string;
    reviewedAt: string | null;
    note: string | null;
  };
}) {
  const [state, formAction] = useActionState(decideBusinessApproval, EMPTY_BUSINESS);

  return (
    <li className="flex flex-col gap-3 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm">
      <div>
        <p className="text-sm font-semibold text-ink-900">{business.name}</p>
        <p className="text-xs text-ink-600">
          {business.ownerName?.trim() || 'Owner name not set'} · created{' '}
          {DATE_FORMATTER.format(new Date(business.createdAt))}
        </p>
        {business.note?.trim() ? (
          <p className="mt-1 text-xs text-ink-700">{business.note}</p>
        ) : null}
      </div>

      <form action={formAction} className="flex flex-col gap-2">
        <input type="hidden" name="businessId" value={business.id} />
        <label htmlFor={`note-${business.id}`} className="text-xs font-semibold text-ink-800">
          Note for the owner (optional)
        </label>
        <input
          id={`note-${business.id}`}
          name="note"
          maxLength={200}
          placeholder="What was checked, or what is missing"
          className="min-h-11 w-full rounded-xl border border-brand-100 bg-white px-3 text-sm text-ink-900"
        />
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="status" value="approved" pendingLabel="Recording…">
            Approve
          </SubmitButton>
          <SubmitButton name="status" value="rejected" variant="secondary" pendingLabel="Recording…">
            Reject
          </SubmitButton>
          {business.status !== 'pending' ? (
            <SubmitButton name="status" value="pending" variant="secondary" pendingLabel="Recording…">
              Put back in queue
            </SubmitButton>
          ) : null}
        </div>
        {state.error ? (
          <p role="alert" className="text-xs font-semibold text-red-800">
            {state.error}
          </p>
        ) : null}
        {state.done ? (
          <p role="status" className="text-xs font-semibold text-brand-700">
            Decision recorded.
          </p>
        ) : null}
      </form>
    </li>
  );
}
