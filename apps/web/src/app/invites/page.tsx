import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { ProfileResponse, ReceivedOffersResponse } from '@tetherproof/shared';
import { signOut } from '@/lib/actions';
import { apiServer, currentProfile } from '@/lib/server/api';
import { Card } from '@/components/ui/Card';
import { SubmitButton } from '@/components/ui/SubmitButton';
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
  if (user.role !== 'worker') redirect(user.role === 'employer' ? '/employer' : '/pending');

  const [profile, inbox] = await Promise.all([
    apiServer<ProfileResponse>('/auth/me'),
    apiServer<ReceivedOffersResponse>('/invites/offers'),
  ]);

  const offers = inbox.offers;
  const waiting = offers.filter((offer) => offer.status === 'pending');
  const answered = offers.filter((offer) => offer.status !== 'pending');

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">TetherProof</p>
          <h1 className="mt-1 text-2xl font-bold text-ink-900 sm:text-3xl">Invitations</h1>
          {inbox.pendingCount > 0 ? (
            <p className="mt-1 text-ink-600">
              {inbox.pendingCount} waiting for your answer.
            </p>
          ) : null}
        </div>
        <form action={signOut}>
          <SubmitButton variant="secondary" className="sm:w-auto">
            Sign out
          </SubmitButton>
        </form>
      </header>

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

      <p className="text-sm text-ink-600">
        Signed in as {profile.fullName ?? 'this account'}.
      </p>
    </main>
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