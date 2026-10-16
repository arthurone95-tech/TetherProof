'use client';

import { useActionState } from 'react';
import { Award, CircleCheck, Clock3, ShieldCheck } from 'lucide-react';
import type { StudentCredential, StudentCredentialsResponse } from '@tetherproof/shared';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { respondToMilestone } from '@/lib/actions';
import { EMPTY_MILESTONE } from '@/lib/form-state';

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Who stands behind the credential, stated plainly.
 *
 * An endorsement with nobody's name on it is the kind of claim this platform exists
 * to make attributable, so the institute and the instructor are named on the card
 * rather than hidden behind an id. Where the signatory's account has since been
 * deleted it says "no longer on the platform" instead of crediting whoever happens to
 * be signed in now — the record survives, the attribution honestly goes blank.
 */
function Issuer({ credential }: { credential: StudentCredential }) {
  // The API resolves both of these through a fallback chain, so a null here means the
  // issuing account genuinely carries no name anywhere — not that a join was missed.
  const institute = credential.organizationName?.trim() || 'A training provider';
  const instructor = credential.instructorName?.trim();
  // When the institution and the signatory are the same string — the usual case for a
  // small institute, where the fallback chain resolved both to the account name —
  // printing it twice reads as two parties. Say it once and name the role.
  const sameParty = Boolean(instructor) && instructor === institute;

  return (
    <p className="mt-2 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-600">
      <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-brand-700" strokeWidth={ICON_STROKE_WIDTH} />
      <span>
        Signed off by <strong className="text-ink-800">{institute}</strong>
        {sameParty ? (
          ' · the instructor who signed it'
        ) : instructor ? (
          <>
            {' · '}
            {instructor}
          </>
        ) : (
          ' · the instructor who recorded this cannot be named'
        )}
      </span>
    </p>
  );
}

/**
 * The student's own credentials, split into what is waiting and what they hold.
 *
 * The two are separate sections rather than one list with a badge, because they are
 * answers to different questions and a merged list invites the reader to count them
 * together. They are not the same kind of evidence: one is a decision the student
 * still has to make, the other is an endorsement they have already agreed to hold.
 *
 * Accepting is worded as accepting, and the card says what it does not do. A
 * student who believed they were adding a client-verified proof would be wrong, and
 * the platform is the only place that can tell them so.
 */
export function StudentCredentialList({
  credentials,
}: {
  credentials: StudentCredentialsResponse;
}) {
  return (
    <div className="flex flex-col gap-5">
      {credentials.awaiting.length > 0 ? (
        <section aria-labelledby="awaiting-heading" className="flex flex-col gap-3">
          <h2
            id="awaiting-heading"
            className="px-1 text-xs font-bold uppercase tracking-wider text-ink-500"
          >
            Waiting for your answer
          </h2>

          {credentials.awaiting.map((credential) => (
            <AwaitingCredential key={credential.id} credential={credential} />
          ))}
        </section>
      ) : null}

      <section aria-labelledby="held-heading" className="flex flex-col gap-3">
        <h2 id="held-heading" className="px-1 text-xs font-bold uppercase tracking-wider text-ink-500">
          Credentials you hold
        </h2>

        {credentials.accepted.length === 0 ? (
          <div className="rounded-xl border border-dashed border-brand-200 bg-brand-50/20 p-6 text-center">
            <p className="text-sm font-semibold text-ink-900">No credentials yet</p>
            <p className="mx-auto mt-1 max-w-md text-xs text-ink-600">
              When a training provider signs off a practical you completed, it appears here for
              you to accept or decline.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {credentials.accepted.map((credential) => (
              <li
                key={credential.id}
                className="rounded-xl border border-emerald-100 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{credential.milestoneTitle}</p>
                    <p className="text-xs text-ink-600">
                      {credential.skillTag} · level {credential.skillLevel}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-emerald-100 px-2 py-1 text-[11px] font-semibold text-emerald-800">
                    <CircleCheck aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_WIDTH} />
                    Held on your record
                  </span>
                </div>

                <Issuer credential={credential} />

                <p className="mt-2 text-xs text-ink-600">
                  Accepted{' '}
                  {credential.answeredAt
                    ? DATE_FORMATTER.format(new Date(credential.answeredAt))
                    : ''}
                </p>

                {credential.note ? (
                  <p className="mt-2 rounded-lg bg-brand-50/60 p-2 text-xs text-ink-700">
                    {credential.note}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function AwaitingCredential({ credential }: { credential: StudentCredential }) {
  const [state, formAction] = useActionState(respondToMilestone, EMPTY_MILESTONE);

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-900">{credential.milestoneTitle}</p>
          <p className="text-xs text-ink-600">
            {credential.skillTag} · level {credential.skillLevel}
          </p>
        </div>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-semibold text-amber-800">
          <Clock3 aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_WIDTH} />
          Needs your answer
        </span>
      </div>

      <Issuer credential={credential} />

      {credential.note ? (
        <p className="mt-3 rounded-lg bg-brand-50/60 p-3 text-sm text-ink-700">{credential.note}</p>
      ) : null}

      {/*
        One form, two buttons, distinguished by their `name`/`value` rather than by
        a hidden field. The action reads which one was pressed, so the two can never
        disagree about what was submitted.
      */}
      <form action={formAction} className="mt-4 flex flex-col gap-2">
        <input type="hidden" name="credentialId" value={credential.id} />
        <div className="flex flex-wrap gap-2">
          <SubmitButton name="response" value="accepted" pendingLabel="Recording…">
            <span className="inline-flex items-center gap-1.5">
              <Award aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
              Accept this credential
            </span>
          </SubmitButton>
          <SubmitButton name="response" value="declined" variant="secondary" pendingLabel="Recording…">
            Decline
          </SubmitButton>
        </div>

        {state.error ? (
          <p role="alert" className="text-sm font-semibold text-red-800">
            {state.error}
          </p>
        ) : null}
      </form>

      <p className="mt-3 text-xs leading-relaxed text-ink-600">
        Accepting adds an endorsement from {credential.organizationName?.trim() || 'a training provider'}{' '}
        to your record. It does not add to the work a customer has verified for you, and it is not
        shown to employers as verified work.
      </p>
    </Card>
  );
}
