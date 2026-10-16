import { Award, CircleCheck, CircleX, Clock3 } from 'lucide-react';
import type { IssuedCredential, MicroCredentialStatus } from '@tetherproof/shared';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

/**
 * Wording for each state, chosen so none of it can be read as a claim that the
 * skill was verified.
 *
 * `awaiting_student` is described as recorded, not issued. `accepted` says the
 * student agreed to hold it — not that it was confirmed, and not that anyone
 * verified the work. `declined` is the student's refusal, which is their business
 * and is shown as a plain outcome rather than a problem.
 */
const STATUS_VIEW: Record<
  MicroCredentialStatus,
  { label: string; icon: typeof Clock3; chip: string; blurb: string }
> = {
  awaiting_student: {
    label: 'Waiting on the student',
    icon: Clock3,
    chip: 'bg-amber-100 text-amber-800',
    blurb: 'Recorded. It becomes a credential once they accept it.',
  },
  accepted: {
    label: 'Accepted by the student',
    icon: CircleCheck,
    chip: 'bg-emerald-100 text-emerald-800',
    blurb: 'Held on their record as an institutional endorsement.',
  },
  declined: {
    label: 'Declined by the student',
    icon: CircleX,
    chip: 'bg-neutral-200 text-ink-700',
    blurb: 'The student chose not to hold it. Recorded, not deleted.',
  },
};

/**
 * What the institute has signed off.
 *
 * Declined credentials stay in the list. Removing them would make a refusal
 * indistinguishable from a mistake, and would quietly invite re-issuing a slightly
 * different milestone to somebody who already said no.
 */
export function IssuedCredentialList({
  credentials,
  awaitingCount,
  acceptedCount,
}: {
  credentials: IssuedCredential[];
  awaitingCount: number;
  acceptedCount: number;
}) {
  return (
    <Card title="Recorded milestones">
      <p className="text-sm text-ink-600">
        {awaitingCount === 0 && acceptedCount === 0
          ? 'Nothing recorded yet.'
          : `${awaitingCount} waiting on a student · ${acceptedCount} accepted.`}{' '}
        None of these count as client-verified work.
      </p>

      {credentials.length === 0 ? null : (
        <ul className="mt-4 flex flex-col gap-2">
          {credentials.map((credential) => {
            const view = STATUS_VIEW[credential.status];
            const Icon = view.icon;

            return (
              <li
                key={credential.id}
                className="rounded-xl border border-brand-100 bg-white p-3 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink-900">
                      {credential.studentName ?? 'Name not set'}
                    </p>
                    <p className="text-xs text-ink-600">
                      {credential.milestoneTitle} · {credential.skillTag} (level{' '}
                      {credential.skillLevel})
                    </p>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${view.chip}`}
                  >
                    <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_WIDTH} />
                    {view.label}
                  </span>
                </div>

                <p className="mt-2 text-xs text-ink-600">
                  Signed off {DATE_FORMATTER.format(new Date(credential.issuedAt))} ·{' '}
                  {view.blurb}
                </p>

                {credential.note ? (
                  <p className="mt-2 rounded-lg bg-brand-50/60 p-2 text-xs text-ink-700">
                    {credential.note}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs leading-relaxed text-ink-600">
        <Award aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={ICON_STROKE_WIDTH} />
        <span>
          A credential says an institution stands behind a skill. A verified proof says a customer
          watched the work happen. They are kept apart everywhere on TetherProof, including in
          what an employer sees.
        </span>
      </p>
    </Card>
  );
}
