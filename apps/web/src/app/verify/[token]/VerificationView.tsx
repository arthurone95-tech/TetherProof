'use client';

import { useCallback, useEffect, useState } from 'react';
import { Mic, X } from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';
import { ApiRequestError, apiFetch } from '@/lib/api';
import { skillLevelLabel } from '@/lib/capabilities';

interface VerificationSummary {
  skillTag: string | null;
  taskSummary: string;
  status: 'awaiting_response' | 'confirmed' | 'rejected';
  expiresAt: string;
  respondedAt: string | null;
  /** The tier the worker claims for this skill, 1 to 3. */
  skillLevel: number | null;
  /** When the worker logged the work. */
  loggedAt: string;
  mediaKind: 'image' | 'audio' | null;
  /** Short-lived signed URL for the evidence. Absent when it could not be produced. */
  mediaUrl: string | null;
  mediaUnavailable: boolean;
  /**
   * Who did the work, when the worker allows it to be shown here.
   *
   * Both null when the worker has not named themselves on verification links, so
   * the page renders the work alone with no gap where an identity would be.
   */
  workerName: string | null;
  workerAvatarUrl: string | null;
}

/**
 * The outcomes the page can land in.
 *
 * Kept apart from the request's own success so that a refusal can be reported for
 * what it is. A link that has been used, one that has run out, one that never
 * existed, and a server that is briefly unreachable are four different situations,
 * and a single "this did not work" would tell the person reading it none of what
 * to do next. The three refusal outcomes are distinguished by the status the API
 * answered with, which is the authoritative record rather than anything the page
 * infers.
 */
/**
 * What the confirm endpoint answers.
 *
 * `withheld` is the platform's own assessment, kept separate from the customer's
 * decision. A customer who confirmed did confirm; the record being held back from
 * counting is a separate fact about the record, and the page reports both rather
 * than collapsing them into a tick.
 */
interface VerifyResult {
  status: 'confirmed' | 'rejected';
  verificationStatus: string;
  withheld: boolean;
  withheldReason: string | null;
}

type ViewState =
  | { phase: 'loading' }
  | { phase: 'ready'; summary: VerificationSummary }
  | { phase: 'submitting'; summary: VerificationSummary }
  | {
      phase: 'done';
      outcome: 'confirmed' | 'rejected';
      withheld: boolean;
      withheldReason: string | null;
    }
  | { phase: 'error'; kind: 'unavailable' | 'spent' | 'expired' | 'temporary'; message: string };

/**
 * The verification page for the person who received or supervised the work.
 *
 * Reached by a link, with no account and no sign-in, so everything it needs must
 * come from the link itself and nothing may require identity. The worker is not
 * named: the person answering needs to judge whether a job was done, and who did
 * it is not part of that judgement — while a name on the page would tell anyone
 * holding a forwarded link who works with them.
 *
 * What it deliberately does not show is the worker's location, the verifier's
 * phone number, the fraud score, and any storage address. The evidence is the one
 * addition to the original page, because a confirmation asked for on the strength
 * of a photograph is not a confirmation if the photograph cannot be seen; it
 * arrives as a short-lived signed URL rather than as anything permanent.
 */
export function VerificationView({ token }: { token: string }) {
  const [state, setState] = useState<ViewState>({ phase: 'loading' });
  const [enlarged, setEnlarged] = useState(false);

  // A random identifier this browser keeps, so the same client answering several
  // proofs is recognisable to the fraud filter without anyone typing a number.
  // Generated and stored entirely on the device: no account, no phone number, and
  // nothing that identifies a person. A browser that refuses storage simply sends
  // nothing, which the server reads as "no information" rather than as suspicion.
  const [verifierKey, setVerifierKey] = useState<string | null>(null);

  useEffect(() => {
    const KEY = 'tetherproof.verifierKey';
    try {
      const existing = window.localStorage.getItem(KEY);
      if (existing && /^[A-Za-z0-9_-]{16,64}$/.test(existing)) {
        setVerifierKey(existing);
        return;
      }
      const bytes = new Uint8Array(24);
      window.crypto.getRandomValues(bytes);
      const generated = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
      window.localStorage.setItem(KEY, generated);
      setVerifierKey(generated);
    } catch {
      // Private mode, a blocked third-party context, or no crypto. The answer is
      // still recorded; the fraud filter simply learns nothing about this verifier.
      setVerifierKey(null);
    }
  }, []);

  const load = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const summary = await apiFetch<VerificationSummary>(`/verifications/${token}`);
      setState({ phase: 'ready', summary });
    } catch (error) {
      setState({ phase: 'error', ...describeFailure(error) });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(response: 'confirmed' | 'rejected') {
    if (state.phase !== 'ready' && state.phase !== 'submitting') return;
    setState({ phase: 'submitting', summary: state.summary });

    try {
      // The server's own verdict, not the button that was pressed. A confirmation
      // the platform then withheld is not a success, and telling the customer
      // otherwise would have them leave believing the work is now trusted proof.
      const result = await apiFetch<VerifyResult>(`/verifications/${token}`, {
        method: 'POST',
        headers: verifierKey ? { 'x-tetherproof-verifier-key': verifierKey } : undefined,
        body: JSON.stringify({ response }),
      });
      setState({
        phase: 'done',
        outcome: response,
        withheld: result.withheld === true,
        withheldReason: result.withheldReason ?? null,
      });
    } catch (error) {
      setState({ phase: 'error', ...describeFailure(error) });
    }
  }

  if (state.phase === 'loading') {
    return (
      <Frame>
        <Card>
          <div aria-busy="true">
            <div className="h-4 w-24 animate-pulse rounded bg-brand-100" />
            <div className="mt-4 h-6 w-full animate-pulse rounded bg-brand-50" />
            <div className="mt-3 h-4 w-3/4 animate-pulse rounded bg-brand-50" />
          </div>
          <p className="sr-only">Loading request details</p>
        </Card>
      </Frame>
    );
  }

  if (state.phase === 'error') {
    const retryable = state.kind === 'temporary';
    return (
      <Frame>
        <Card title={titles[state.kind]}>
          <p role="alert" className="text-ink-600">
            {state.message}
          </p>
          {retryable ? (
            <div className="mt-6">
              <Button variant="secondary" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : null}
        </Card>
      </Frame>
    );
  }

  if (state.phase === 'done') {
    const confirmed = state.outcome === 'confirmed';

    // The record's own state, not the customer's answer. Reporting "thank you,
    // recorded" for a record the platform is withholding would be a false claim
    // on the one screen where the customer is deciding whether to trust us.
    if (state.withheld) {
      return (
        <Frame>
          <Card>
            <div role="status" aria-live="polite" className="text-center">
              <div
                aria-hidden="true"
                className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-amber-50 text-2xl text-amber-700"
              >
                !
              </div>
              <h1 className="text-xl font-semibold text-ink-900">Your answer is recorded</h1>
              <p className="mt-2 text-ink-600">
                Thank you — you confirmed this work, and that is saved.
              </p>
              <p className="mt-3 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
                One thing to be aware of: this record is being held back from counting as verified
                proof while TetherProof checks it. That is not a judgement about you or about the
                worker, and it has not affected anything you did.
              </p>
              <p className="mt-4 text-sm text-ink-600">
                This link cannot be used again. You can close this page.
              </p>
            </div>
          </Card>
        </Frame>
      );
    }

    return (
      <Frame>
        <Card>
          <div role="status" aria-live="polite" className="text-center">
            <div
              aria-hidden="true"
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-brand-50 text-2xl text-brand-600"
            >
              {confirmed ? '✓' : '!'}
            </div>
            <h1 className="text-xl font-semibold text-ink-900">
              {confirmed ? 'Thank you' : 'Request noted'}
            </h1>
            <p className="mt-2 text-ink-600">
              {confirmed
                ? 'Your confirmation has been recorded on the worker’s record.'
                : 'The worker has been told that something needs attention.'}
            </p>
            <p className="mt-4 text-sm text-ink-600">
              This link cannot be used again. You can close this page.
            </p>
          </div>
        </Card>
      </Frame>
    );
  }

  const { summary } = state;
  const busy = state.phase === 'submitting';
  const answerable = summary.status === 'awaiting_response';

  return (
    <Frame>
      <Card>
        <p className="text-sm font-semibold tracking-wide text-brand-600">TetherProof</p>
        <h1 className="mt-2 text-xl font-semibold text-ink-900">Was this work completed?</h1>
        <p className="mt-2 text-sm text-ink-600">
          Someone has logged work they say you received or supervised. Check it matches what you
          know, then answer. You do not need an account.
        </p>

        {/*
          The worker, when they have allowed themselves to be named on a
          verification link. A link is forwardable, so this is the one field on the
          page that a worker can withhold, and when they do the whole block is
          absent rather than showing an empty frame — the reader is looking at work,
          and who did it is not something they are owed.

          Nothing else about the worker is here: no location, no contact details, no
          other work, no account information.
        */}
        {summary.workerName ? (
          <div className="mt-5 flex items-center gap-3 border-y border-brand-100 py-4">
            <Avatar name={summary.workerName} src={summary.workerAvatarUrl} size="md" />
            <div className="min-w-0">
              <p className="truncate text-base font-semibold text-ink-900">
                {summary.workerName}
              </p>
              <p className="text-sm text-ink-600">Logged this work</p>
            </div>
          </div>
        ) : null}

        <dl className={`grid gap-3 py-4 text-sm sm:grid-cols-2 ${summary.workerName ? '' : 'mt-5 border-y border-brand-100'}`}>
          <div>
            <dt className="text-ink-600">Skill</dt>
            <dd className="font-medium text-ink-900">{summary.skillTag ?? 'Not stated'}</dd>
          </div>
          {summary.skillLevel ? (
            <div>
              <dt className="text-ink-600">Level they claim</dt>
              <dd className="font-medium text-ink-900">{skillLevelLabel(summary.skillLevel as 1 | 2 | 3)}</dd>
            </div>
          ) : null}
          <div>
            <dt className="text-ink-600">Logged</dt>
            <dd className="font-medium text-ink-900">{formatDate(summary.loggedAt)}</dd>
          </div>
          <div>
            <dt className="text-ink-600">{answerable ? 'Answer by' : 'Answered'}</dt>
            <dd className="font-medium text-ink-900">
              {summary.respondedAt ? formatDate(summary.respondedAt) : formatDate(summary.expiresAt)}
            </dd>
          </div>
        </dl>

        <div className="mt-4">
          <h2 className="text-sm font-semibold tracking-wide text-ink-900 uppercase">
            What they say they did
          </h2>
          <p className="mt-2 text-ink-700">{summary.taskSummary}</p>
        </div>

        <div className="mt-4">
          <h2 className="text-sm font-semibold tracking-wide text-ink-900 uppercase">Evidence</h2>
          <Evidence
            summary={summary}
            onOpen={() => setEnlarged(true)}
            onReload={() => void load()}
          />
        </div>

        {/*
          The full-screen view, rendered as a sibling of the card rather than
          inside it, so it is not clipped by the card's own bounds and covers the
          page whatever the viewport. It is only mounted while open, which is what
          keeps a closed page free of a full-screen element for a reader who never
          taps the picture.
        */}
        {enlarged && summary.mediaUrl && summary.mediaKind !== 'audio' ? (
          <Lightbox
            src={summary.mediaUrl}
            alt={`Photo of the ${summary.skillTag ?? 'work'} they say they completed`}
            onClose={() => setEnlarged(false)}
          />
        ) : null}

        {answerable ? (
          <>
            <p className="mt-6 text-sm text-ink-600" id="confirm-hint">
              This records whether this job was completed as described. Confirming says the work
              happened as written — it does not certify every part of it was perfect, and it is not a
              general judgement of the worker. Your answer is shared with the worker and cannot be
              changed afterwards.
            </p>
            <div className="mt-4 flex flex-col gap-3" aria-describedby="confirm-hint">
              <Button disabled={busy} onClick={() => void respond('confirmed')}>
                {busy ? 'Sending…' : 'Yes, this work was completed'}
              </Button>
              <Button variant="danger" disabled={busy} onClick={() => void respond('rejected')}>
                No — this work was not completed as described
              </Button>
            </div>
          </>
        ) : (
          <div role="status" aria-live="polite" className="mt-6">
            <p className="text-ink-600">
              This request was already answered
              {summary.respondedAt ? ` on ${formatDate(summary.respondedAt)}` : ''}. It cannot be
              answered again.
            </p>
          </div>
        )}
      </Card>
    </Frame>
  );
}

/**
 * The evidence, or a plain statement of why there is none.
 *
 * A photograph is shown inline and can be opened full-screen, because the whole
 * question is whether the picture shows the work and a thumbnail on a phone is not
 * enough to judge that. The enlargement is still the same signed URL rendered by
 * the same page — it does not fetch a second, larger copy, and it exposes no
 * storage path or credential.
 *
 * A file that cannot be signed for is reported as unavailable rather than left as a
 * gap, so an absent picture is never mistaken for evidence that was withheld.
 */
function Evidence({
  summary,
  onOpen,
  onReload,
}: {
  summary: VerificationSummary;
  onOpen: () => void;
  onReload: () => void;
}) {
  if (summary.mediaUnavailable) {
    return (
      <p className="mt-2 text-sm text-ink-600">
        The photo or recording could not be loaded just now. You can still answer based on what is
        written above.
      </p>
    );
  }

  if (!summary.mediaUrl) {
    return (
      <p className="mt-2 text-sm text-ink-600">
        No photo or recording was attached to this request.
      </p>
    );
  }

  if (summary.mediaKind === 'audio') {
    return <AudioEvidence summary={summary} onReload={onReload} />;
  }

  return (
    <div className="mt-2">
      {/*
        A real button, not a bare `<img onClick>`. The picture is the control, so
        it has to be reachable by keyboard and announce itself as something that can
        be activated — an image with a click handler is neither. The label is
        carried by `aria-label` rather than by text on the page, which is what keeps
        the page free of a caption explaining an interaction everybody already
        knows: tap the picture, it opens.
      */}
      <button
        type="button"
        onClick={onOpen}
        aria-label={`View ${summary.skillTag ?? 'the work'} photo full size`}
        className="block w-full cursor-zoom-in overflow-hidden rounded-2xl border border-brand-100 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-600"
      >
        {/*
          `onError` is a load-failure hook, not a user interaction, and the
          interactivity here belongs to the surrounding button — this element is
          simply its content. Silenced for that reason rather than rule-wide.
        */}
        {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
        <img
          src={summary.mediaUrl}
          alt={`Photo of the ${summary.skillTag ?? 'work'} they say they completed`}
          // The signed URL is deliberately short-lived, so a page left open past it
          // would otherwise show a broken image to the one person whose judgement
          // the record depends on. Reloading mints a fresh one; it cannot resurrect
          // anything, because the token is still the only thing that opened this
          // page and it has not been spent by looking.
          onError={onReload}
          className="max-h-80 w-full object-cover"
        />
      </button>
    </div>
  );
}

/**
 * A voice note, as a recording rather than as a picture.
 *
 * Built for its own medium instead of borrowing the photo's presentation. A
 * recording has no single frame to enlarge, so there is no full-screen view to
 * open and nothing here pretends otherwise: what it has instead is somewhere to
 * start, somewhere to scrub, and a control large enough to hit on a phone with
 * one hand — the native player, given room to breathe.
 *
 * The same short-lived signed URL serves it. Nothing is fetched twice and no
 * storage path or credential is exposed, and the error handler mints a fresh one
 * rather than leaving the reader with a dead control.
 */
function AudioEvidence({
  summary,
  onReload,
}: {
  summary: VerificationSummary;
  onReload: () => void;
}) {
  return (
    <div className="mt-2 rounded-2xl border border-brand-100 bg-brand-50/40 p-4">
      <div className="flex items-center gap-2">
        <Mic aria-hidden="true" className="h-4 w-4 text-brand-700" strokeWidth={ICON_STROKE_WIDTH} />
        <p className="text-sm font-semibold text-ink-900">Voice note</p>
      </div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio
        controls
        preload="metadata"
        src={summary.mediaUrl ?? undefined}
        onError={onReload}
        className="mt-3 w-full"
      />
      <p className="mt-3 text-xs text-ink-600">
        The recording is the evidence. Play it as much as you need before you answer.
      </p>
    </div>
  );
}

/**
 * The photograph at full size, over the page.
 *
 * Opened by tapping the picture and dismissed by the control at the top or the
 * dark surround — the two places a thumb already goes, and neither needs an
 * instruction because neither carries text. The button does carry an accessible
 * name, because a control with no label is unusable by keyboard or screen reader,
 * and that is an accessibility requirement rather than an explanation for the
 * reader.
 *
 * Escape and a tap on the backdrop are both handled because both are expected of
 * anything that covers the page. The body is locked while it is open so the page
 * underneath cannot scroll behind the photograph, and restored on the way out even
 * if the component unmounts while open.
 */
function Lightbox({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo, full size"
      className="fixed inset-0 z-50 flex flex-col bg-ink-900/95"
    >
      <div className="flex justify-end p-3">
        <button
          type="button"
          onClick={onClose}
          autoFocus
          aria-label="Close"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white"
        >
          <X aria-hidden="true" className="h-6 w-6" strokeWidth={ICON_STROKE_WIDTH} />
        </button>
      </div>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        tabIndex={-1}
        className="min-h-0 flex-1 cursor-zoom-out overflow-auto p-4"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={alt}
          className="mx-auto max-w-full rounded-xl object-contain"
        />
      </button>
    </div>
  );
}

const titles = {
  unavailable: 'This request could not be opened',
  spent: 'This link has already been used',
  expired: 'This request has expired',
  temporary: 'Something went wrong',
} as const;

/**
 * Turns a failed request into a reported outcome.
 *
 * The status decides the wording because the status is the server's authoritative
 * answer about this token: `404` means no such request, `409` means one was made
 * and has been dealt with, `410` means one existed and ran out. Collapsing them
 * into one message would make a permanently closed link look like a temporary
 * glitch, which is the opposite of what the reader needs to know.
 *
 * A retry is offered only where retrying could help.
 */
function describeFailure(
  error: unknown,
): { kind: 'unavailable' | 'spent' | 'expired' | 'temporary'; message: string } {
  if (error instanceof ApiRequestError) {
    // 400 as well as 404: a malformed token is refused by the parameter validator
    // before any lookup happens, so a mistyped or truncated link arrives as a bad
    // request rather than as "not found". Both mean the same thing to the person
    // reading the page, and only one of them would be told the link is unusable.
    if (error.status === 404 || error.status === 400) {
      return {
        kind: 'unavailable',
        message: 'This link is not valid. It may have been mistyped, or the request may have been withdrawn.',
      };
    }
    if (error.status === 409) {
      return {
        kind: 'spent',
        message: 'This request has already been answered or withdrawn, so it cannot be answered again.',
      };
    }
    if (error.status === 410) {
      return {
        kind: 'expired',
        message: 'This request ran out before anyone answered it. Ask the worker for a fresh link.',
      };
    }
    return {
      kind: 'temporary',
      message: 'We could not load this request just now. Please try again.',
    };
  }

  // A network failure, or a response that never arrived. Worth retrying.
  return {
    kind: 'temporary',
    message: 'We could not reach TetherProof just now. Check your connection and try again.',
  };
}

function formatDate(iso: string): string {
  const when = new Date(iso);
  if (Number.isNaN(when.getTime())) return 'Unknown';
  return when.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-4 py-10">
      {children}
    </main>
  );
}
