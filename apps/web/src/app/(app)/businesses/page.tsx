import type { Metadata } from 'next';
import Link from 'next/link';
import { CircleCheck, Clock3, ShieldX, Users } from 'lucide-react';
import type { BusinessesResponse } from '@tetherproof/shared';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { apiServer } from '@/lib/server/api';
import { BusinessForm } from './BusinessForm';

export const metadata: Metadata = {
  title: 'Your businesses — TetherProof',
};

const DATE_FORMATTER = new Intl.DateTimeFormat(undefined, {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const STATUS: Record<
  BusinessesResponse['businesses'][number]['status'],
  { label: string; hint: string; chip: string; icon: typeof Clock3 }
> = {
  pending: {
    label: 'In review',
    hint: 'An administrator is checking this business. You can keep working meanwhile.',
    chip: 'bg-amber-100 text-amber-800',
    icon: Clock3,
  },
  approved: {
    label: 'Approved',
    hint: 'You can hire through this business.',
    chip: 'bg-emerald-100 text-emerald-800',
    icon: CircleCheck,
  },
  rejected: {
    label: 'Not approved',
    hint: 'An administrator did not approve this business.',
    chip: 'bg-red-100 text-red-800',
    icon: ShieldX,
  },
};

/**
 * The account's businesses.
 *
 * ## Why hiring is behind an approved business at all
 *
 * Because "employer" used to mean a person claimed they hired people, and an employer
 * account can send an unsolicited invitation to a worker. Routing hiring through a business
 * moves the question from "do we believe this person?" to "has somebody checked this
 * organisation?", which is a question that has an answer.
 *
 * ## Why a pending business is a working state and not a broken one
 *
 * Self-registration stays open, so there is somebody able to approve. A person who sets up
 * a business on Monday is not blocked all week — they keep their worker workspace, their
 * credentials, everything they had. Only hiring waits, which is the part that reaches
 * somebody who never agreed to be contacted.
 *
 * ## The stated boundary
 *
 * Business records — specs, saved candidates, invitations — are still keyed on the person
 * rather than the business. Somebody running two businesses sees one set of employer
 * records today. That is a deliberate simplification of the agreed design, recorded in
 * `doc/13` E-056 rather than hidden.
 */
export default async function BusinessesPage() {
  const { businesses } = await apiServer<BusinessesResponse>('/businesses');

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold text-ink-900">Your businesses</h1>
        <p className="text-sm text-ink-600">
          Hiring runs through a business, so your personal work profile stays separate from who you
          are hiring for.
        </p>
      </header>

      {businesses.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {businesses.map((business) => {
            const status = STATUS[business.status];
            const Icon = status.icon;
            return (
              <li
                key={business.id}
                className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-brand-100 bg-white p-4 shadow-sm"
              >
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink-900">{business.name}</p>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-600">
                    <span className="inline-flex items-center gap-1">
                      <Users aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_WIDTH} />
                      {business.memberCount}{' '}
                      {business.memberCount === 1 ? 'member' : 'members'}
                    </span>
                    <span>
                      Created {DATE_FORMATTER.format(new Date(business.createdAt))}
                    </span>
                  </p>
                  <p className="mt-1 text-xs text-ink-600">
                    {business.note?.trim() || status.hint}
                  </p>
                </div>
                <span
                  className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[11px] font-semibold ${status.chip}`}
                >
                  <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={ICON_STROKE_WIDTH} />
                  {status.label}
                </span>
              </li>
            );
          })}
        </ul>
      ) : (
        <Banner tone="info" title="No businesses yet">
          Set one up below if you need to hire. You do not need one to use the rest of
          TetherProof.
        </Banner>
      )}

      <Card title="Set up a business">
        <p className="text-sm text-ink-600">
          Hiring is held until an administrator reviews the business. That is the only thing
          that waits — everything else on your account keeps working while it is reviewed.
        </p>
        <BusinessForm />
      </Card>

      <p className="text-xs text-ink-600">
        Looking for workers rather than hiring them?{' '}
        <Link href="/capabilities" className="font-semibold text-brand-700 hover:text-brand-800">
          Your workspaces →
        </Link>
      </p>
    </div>
  );
}
