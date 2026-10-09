import type { ProofListItem, SkillLevel, VerificationStatus } from '@tetherproof/shared';
import Link from 'next/link';
import { AudioLines } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { skillLevelLabel } from '@/lib/capabilities';

/**
 * One logged job in the logbook and on the dashboard's recent list.
 *
 * The thumbnail is the left square the design calls for: the photo itself for a
 * photo proof, a playable-looking placeholder for a recording. Images are
 * rendered with a plain `img` because the URL is a short-lived signed link from
 * the API, minted per request, which is not something `next/image` can optimise
 * without the bucket domain being a static remote pattern.
 */
export function ProofListItemView({ item }: { item: ProofListItem }) {
  return (
    <Link
      href={`/logs/${item.id}`}
      className="flex items-stretch gap-3 rounded-2xl border border-brand-100 bg-white p-3 transition-colors hover:border-brand-600"
    >
      <Thumbnail item={item} />
      <div className="min-w-0 flex-1 self-center">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-base font-semibold text-ink-900">{item.skillTag}</p>
          <SkillLevelBadge level={item.skillLevel} />
          <VerificationStatusPill status={item.verificationStatus} />
        </div>
        <p className="mt-0.5 line-clamp-2 text-sm text-ink-600">{item.description}</p>
        <p className="mt-1 text-xs text-ink-600">
          {new Date(item.createdAt).toLocaleDateString(undefined, {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
          })}
        </p>
      </div>
    </Link>
  );
}

function Thumbnail({ item }: { item: ProofListItem }) {
  if (item.mediaKind === 'image' && item.mediaUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return (
      // eslint-disable-next-line jsx-a11y/alt-text
      <img
        src={item.mediaUrl}
        alt={`Photo of ${item.skillTag} work`}
        className="h-16 w-16 shrink-0 rounded-xl border border-brand-100 object-cover"
      />
    );
  }
  return (
    <div
      aria-hidden="true"
      className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-brand-100 bg-brand-50 text-brand-600"
    >
      <AudioLines className="h-6 w-6" strokeWidth={ICON_STROKE_WIDTH} />
    </div>
  );
}

/** How a verification verdict reads, in a colour the design already uses. */
const PILL_FOR_STATUS: Record<
  VerificationStatus,
  { label: string; className: string }
> = {
  pending: { label: 'Awaiting confirmation', className: 'bg-amber-50 text-amber-800' },
  verified: { label: 'Verified', className: 'bg-brand-50 text-brand-700' },
  rejected: { label: 'Not confirmed', className: 'bg-red-50 text-red-800' },
  fraud_blocked: { label: 'Blocked', className: 'bg-red-50 text-red-800' },
};

export function VerificationStatusPill({ status }: { status: VerificationStatus }) {
  const { label, className } = PILL_FOR_STATUS[status];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${className}`}
    >
      {label}
    </span>
  );
}

/** The worker's stated proficiency tier for a skill, in the logbook's pill language. */
export function SkillLevelBadge({ level }: { level: SkillLevel }) {
  return (
    <span className="inline-flex shrink-0 items-center rounded-full bg-brand-50 px-2.5 py-0.5 text-xs font-semibold text-brand-700">
      {skillLevelLabel(level)}
    </span>
  );
}