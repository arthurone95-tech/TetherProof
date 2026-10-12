'use client';

import { useEffect, useState } from 'react';
import { Share2 } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

interface ShareLinkButtonProps {
  /** The verification URL the backend generated. Shown as-is; never rebuilt here. */
  url: string;
  /** Heading line for the share sheet, naming the site rather than the worker. */
  title?: string;
  /** Body text the recipient reads before tapping the link. */
  text?: string;
  className?: string;
  label?: string;
}

/**
 * Opens the device's own sharing sheet for a verification link.
 *
 * The Web Share API is the only way to reach WhatsApp, Messages, email, or any
 * other installed app without collecting the person's number or knowing which
 * service they use — which is the whole point, since the work-logging form does not
 * ask for a number and should not need to.
 *
 * Three things it deliberately does not do:
 *
 * * **It does not say the link was sent.** `navigator.share` resolves when the
 *   share *sheet closes*, which includes the user picking a contact and then
 *   backing out. Reporting success here would be a claim the code cannot support,
 *   so nothing is reported: the button simply returns to its resting state.
 * * **It does not mint anything.** The URL is the one the API issued, and the
 *   token behind it exists exactly once. Sharing it is a delivery of that token,
 *   not a second request, so there is still only one decision to be made on it.
 * * **It does not require Web Share.** Where the API is missing, this renders
 *   nothing at all and the adjacent Copy link remains the whole fallback, rather
 *   than offering a button that cannot work.
 *
 * The absence of the API is a fact about the browser, not about the session, so it
 * is checked after mount: rendering nothing on the server keeps the server markup
 * and the client tree identical, which is what stops React discarding the rest of
 * the panel during hydration.
 */
export function ShareLinkButton({
  url,
  title = 'Confirm work on TetherProof',
  text = 'Someone has logged work you received or supervised. Please confirm whether it was completed as described.',
  className,
  label = 'Share verification link',
}: ShareLinkButtonProps) {
  const [shareable, setShareable] = useState(false);
  const [busy, setBusy] = useState(false);
  // A failure worth saying something about. A cancelled share is not, so it is
  // never recorded: the user closing the sheet did exactly what they meant to.
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    setShareable(typeof navigator !== 'undefined' && typeof navigator.share === 'function');
  }, []);

  async function share(): Promise<void> {
    setNotice(null);
    setBusy(true);
    try {
      await navigator.share({ title, text, url });
      // Intentionally silent. The sheet closing is not proof of delivery.
    } catch (error) {
      // `AbortError` is the user dismissing the sheet. Anything else is a real
      // failure worth a line, and the only honest one: the text is still on
      // screen to copy by hand.
      const cancelled =
        error instanceof Error && (error.name === 'AbortError' || error.name === 'NotAllowedError');
      if (!cancelled) {
        setNotice('Sharing did not work here. Copy the link instead.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!shareable) return null;

  return (
    <div className="flex flex-col gap-1.5">
      <button
        type="button"
        onClick={() => void share()}
        disabled={busy}
        className={
          className ??
          'inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-60'
        }
      >
        <Share2 aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
        {label}
      </button>
      {notice ? (
        <p role="alert" className="text-xs font-medium text-red-800">
          {notice}
        </p>
      ) : null}
    </div>
  );
}
