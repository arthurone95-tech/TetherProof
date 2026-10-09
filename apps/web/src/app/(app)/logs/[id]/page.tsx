import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ProofDetailResponse } from '@tetherproof/shared';
import { ResendLinkButton } from '@/components/proofs/ResendLinkButton';
import { SkillLevelBadge, VerificationStatusPill } from '@/components/proofs/ProofListItemView';
import { ApiRequestError } from '@/lib/api-error';
import { prettyCoords } from '@/lib/gps';
import { apiServer, currentProfile } from '@/lib/server/api';
import { EditLogForm } from './EditLogForm';

export const metadata: Metadata = {
  title: 'Log entry — TetherProof',
};

/**
 * One log entry: the media, the words, where it happened, the transcript of any
 * voice recording, and — while nothing has been sent out for confirmation yet —
 * the form to correct it.
 *
 * The freeze rule is the API's decision and is re-checked at the write, so the
 * edit form is shown only when the detail says it is allowed, and a save that
 * races a sent link is still refused. Once a link is out, the confirmation box
 * takes the edit form's place: a live link says when it stops working, and an
 * expired one offers a fresh link on the spot.
 */
export default async function LogDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ updated?: string }>;
}) {
  const { id } = await params;
  const { updated } = await searchParams;

  const user = await currentProfile();
  if (!user) redirect('/login');
  if (user.role !== 'worker') redirect(user.role === 'employer' ? '/employer' : '/pending');

  let proof: ProofDetailResponse['proof'];
  try {
    ({ proof } = await apiServer<ProofDetailResponse>(`/workers/proofs/${id}`));
  } catch (error) {
    if (error instanceof ApiRequestError && error.status === 404) {
      return (
        <div className="rounded-2xl border border-dashed border-brand-200 bg-white p-8 text-center">
          <p className="text-lg font-semibold text-ink-900">That log was not found</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-ink-600">
            It may have been removed, or the link no longer matches anything on your record.
          </p>
          <Link
            href="/logs"
            className="mt-4 inline-flex min-h-11 items-center rounded-xl border border-brand-600 px-5 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            Back to your logs
          </Link>
        </div>
      );
    }
    throw error;
  }

  const loggedOn = new Date(proof.createdAt).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });

  // A link has gone out for this log and has not been answered. The link is
  // either still live — the verifier can still answer — or it has expired,
  // which is the one state where a fresh link resolves the log.
  const confirmationOutstanding = proof.verificationStatus === 'pending' && proof.verificationLinkSent;
  const confirmationExpired =
    confirmationOutstanding && proof.verificationExpiresAt === null;

  // A concluded log — confirmed, refused, or blocked — is frozen for good and
  // carries no action to take.
  const concluded = proof.verificationStatus !== 'pending';

  return (
    <div className="flex flex-col gap-6">
      <Link
        href="/logs"
        className="self-start text-sm font-semibold text-brand-700 hover:text-brand-800"
      >
        ← All logs
      </Link>

      {updated ? (
        <div
          role="status"
          className="rounded-xl bg-brand-50 px-4 py-3 text-sm font-medium text-brand-800"
        >
          Changes saved.
        </div>
      ) : null}

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-ink-900 sm:text-3xl">{proof.skillTag}</h1>
            <SkillLevelBadge level={proof.skillLevel} />
            <VerificationStatusPill status={proof.verificationStatus} />
          </div>
          <p className="mt-1 text-sm text-ink-600">Logged {loggedOn}</p>
        </div>
      </header>

      {proof.mediaKind === 'image' && proof.mediaUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={proof.mediaUrl}
          alt={`Photo of ${proof.skillTag} work`}
          className="max-h-96 w-full rounded-2xl border border-brand-100 object-cover"
        />
      ) : proof.mediaUrl ? (
        <div className="rounded-2xl border border-brand-100 bg-white p-5">
          {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
          <audio controls src={proof.mediaUrl} preload="metadata" className="w-full" />
        </div>
      ) : null}

      <div className="rounded-2xl border border-brand-100 bg-white p-5">
        <h2 className="text-sm font-semibold tracking-wide text-ink-900 uppercase">
          What you did
        </h2>
        <p className="mt-2 whitespace-pre-wrap text-ink-700">{proof.description}</p>
      </div>

      {proof.transcript ? (
        <div className="rounded-2xl border border-brand-100 bg-white p-5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-900 uppercase">
            Voice recording transcript
          </h2>
          <p className="mt-2 text-sm text-ink-600">
            Read straight from the recording. Transcriptions are best-effort — the recording
            itself is what is kept and verified.
          </p>
          <p className="mt-3 whitespace-pre-wrap text-ink-700">{proof.transcript}</p>
        </div>
      ) : null}

      {proof.submissionGps ? (
        <div className="rounded-2xl border border-brand-100 bg-white p-5">
          <h2 className="text-sm font-semibold tracking-wide text-ink-900 uppercase">
            Where it happened
          </h2>
          <p className="mt-2 font-mono text-sm text-ink-700">{prettyCoords(proof.submissionGps)}</p>
        </div>
      ) : null}

      {confirmationOutstanding ? (
        <div className="rounded-2xl border border-amber-200/70 bg-amber-50 p-5">
          <h2 className="text-sm font-semibold tracking-wide text-amber-900 uppercase">
            Confirmation
          </h2>
          {confirmationExpired ? (
            <>
              <p className="mt-2 text-sm font-medium text-amber-900">
                The confirmation link for this log expired without an answer.
              </p>
              <p className="mt-1 text-sm text-amber-800">
                Raise a fresh link and share it again — the new link lasts just as long as the
                first one.
              </p>
              <div className="mt-3">
                <ResendLinkButton proofId={proof.id} subtle />
              </div>
            </>
          ) : (
            <>
              <p className="mt-2 text-sm text-amber-900">
                A confirmation link was sent for this log. It is live until{' '}
                <strong>
                  {expiryDate(proof.verificationExpiresAt ?? '')}
                </strong>
                , and the person confirming your work can still answer while it is.
              </p>
              <p className="mt-1 text-sm text-amber-800">
                The record is fixed once the answer comes back.
              </p>
            </>
          )}
        </div>
      ) : null}

      {!confirmationOutstanding && !concluded ? (
        <div className="rounded-2xl border border-brand-100 bg-white p-6">
          <h2 className="text-lg font-semibold text-ink-900">Edit this log</h2>
          <p className="mt-1 text-sm text-ink-600">
            It can still be changed because no confirmation link has been sent for it yet. Once
            one goes out, the record is fixed.
          </p>
          <div className="mt-4">
            <EditLogForm proof={proof} />
          </div>
        </div>
      ) : null}

      {concluded ? (
        <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-ink-700">
          This log has already been confirmed and can no longer be edited.
          {proof.verificationStatus === 'rejected'
            ? ' It was not confirmed by the person it was sent to.'
            : proof.verificationStatus === 'fraud_blocked'
              ? ' It was blocked by the anti-fraud engine.'
              : ' The verification is on your record.'}
        </p>
      ) : null}
    </div>
  );
}

function expiryDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}