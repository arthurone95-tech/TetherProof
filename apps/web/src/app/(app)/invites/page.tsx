import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { currentProfile } from '@/lib/server/api';
import { homeFor } from '@/lib/navigation';
import { getInvitationInbox } from '@/lib/server/shell-data';
import { Card } from '@/components/ui/Card';
import { RespondForm } from './RespondForm';

export const metadata: Metadata = {
  title: 'Invitations — TetherProof',
};

/**
 * A worker's invitation inbox.
 *
 * Shows who invited them and what they said, and nothing else about the employer: no
 * contact details, no account id, no record of who else they have approached. A
 * worker needs enough to judge whether the offer is real, and not enough to be
 * mapped from one response to the next.
 */
export default async function InvitesPage() {
  const user = await currentProfile();
  if (!user) redirect('/login');
  if (!user.capabilities.includes('worker')) redirect(homeFor(user));

  const inbox = await getInvitationInbox();

  const offers = inbox.offers;
  const waiting = offers.filter((offer) => offer.status === 'pending');
  const answered = offers.filter((offer) => offer.status !== 'pending');

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6">
      {/*
        The page carries no heading of its own: opened from the header menu
        (or the invitation icon beside the desktop nav), the header already
        says "Invitations". What is left here is only the inbox itself.
      */}
      <Card title="Waiting for your answer">
        {waiting.length === 0 ? (
          <p className="rounded-xl bg-brand-50 p-4 text-sm text-ink-600">
            Nothing is waiting for you right now. Employers can only reach you if you already have verified
            proof of work, so keep logging completed jobs.
          </p>
        ) : (
          <ul className="space-y-4">
            {waiting.map((offer) => (
              <li key={offer.id} className="rounded-xl border border-brand-100 p-4">
                <OfferBody
                  organization={offer.employerOrganization}
                  approved={offer.employerApproved}
                  note={offer.note}
                  createdAt={offer.createdAt}
                />
                <RespondForm offerId={offer.id} organization={offer.employerOrganization} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Already answered">
        {answered.length === 0 ? (
          <p className="text-sm text-ink-600">Once you answer an invitation it is listed here.</p>
        ) : (
          <ul className="space-y-3">
            {answered.map((offer) => (
              <li key={offer.id} className="rounded-xl border border-brand-100 p-4">
                <OfferBody
                  organization={offer.employerOrganization}
                  approved={offer.employerApproved}
                  note={offer.note}
                  createdAt={offer.createdAt}
                />
                <p className="mt-3 text-sm font-medium text-ink-600">
                  {offer.status === 'accepted' ? 'You accepted this.' : 'You declined this.'}
                  {offer.respondedAt ? ` On ${new Date(offer.respondedAt).toLocaleDateString()}.` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function OfferBody({
  organization,
  approved,
  note,
  createdAt,
}: {
  organization: string | null;
  approved: boolean;
  note: string | null;
  createdAt: string;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold text-ink-900">{organization ?? 'An employer on TetherProof'}</p>
        <span className="text-sm text-ink-600">{new Date(createdAt).toLocaleDateString()}</span>
      </div>
      {approved ? null : (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs font-medium text-ink-900">
          This employer's account has not been reviewed by our team yet. You can decline, and you may want
          to ask for their details before you accept.
        </p>
      )}
      {note ? <p className="mt-2 text-ink-600">{note}</p> : null}
    </>
  );
}