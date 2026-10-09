import type { WorkerCapabilityProfileResponse } from '@tetherproof/shared';
import { skillLevelLabel } from '@/lib/capabilities';

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/**
 * The worker's proven record, one row per skill.
 *
 * Everything here is derived from verified rows on the worker's own account —
 * nothing is editable by choice, and the same aggregation powers the public
 * shareable page. The row carries the level the worker's blocks sit at, the
 * number of proofs an employer actually confirmed, and the total logged under
 * the skill, because "12 logged, 3 verified" reads the record honestly where a
 * single total would blur the two.
 */
export function CapabilitiesCard({ capabilities }: { capabilities: WorkerCapabilityProfileResponse }) {
  if (capabilities.skills.length === 0) {
    return (
      <p className="text-sm text-ink-600">
        Log and verify some work and your proven capabilities will appear here.
      </p>
    );
  }

  return (
    <ul className="flex flex-col gap-3">
      {capabilities.skills.map((skill) => (
        <li key={skill.skillTag} className="rounded-xl border border-brand-100 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold text-ink-900">{skill.skillTag}</p>
              <p className="mt-0.5 text-sm text-ink-600">
                {skill.verifiedProofs} verified proof{skill.verifiedProofs === 1 ? '' : 's'} of {skill.totalLogs}{' '}
                logged
              </p>
            </div>
            <span
              className="shrink-0 rounded-full bg-brand-50 px-2.5 py-1 text-xs font-semibold text-brand-700"
              title={`Level ${skill.skillLevel}`}
            >
              {skillLevelLabel(skill.skillLevel)}
            </span>
          </div>
          {skill.lastVerifiedAt ? (
            <p className="mt-2 text-xs text-ink-500">
              Last verified {DATE_FORMATTER.format(new Date(skill.lastVerifiedAt))}
            </p>
          ) : null}
        </li>
      ))}
    </ul>
  );
}