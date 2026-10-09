'use client';

import { useActionState, useState } from 'react';
import { Check, Copy, RotateCcw } from 'lucide-react';
import { resendVerification } from '@/lib/actions';
import type { ResendActionState } from '@/lib/actions';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

interface ResendLinkButtonProps {
  proofId: string;
  /** A quiet variant for a notice tucked into a page rather than a card of its own. */
  subtle?: boolean;
}

/**
 * Issues a fresh confirmation link for one log, in place.
 *
 * A resend is a deliberate repeat — the API refuses one while a link is still
 * outstanding or the log is concluded — and the fresh token is returned exactly
 * once, so the result renders right under the button: the address to share, the
 * moment it stops working, and a copy control. The button is used both on the
 * notifications feed's expiring list and on a log whose link ran out, so the
 * whole exchange lives in one component instead of two forms converging on the
 * same action.
 */
export function ResendLinkButton({ proofId, subtle = false }: ResendLinkButtonProps) {
  const [state, action] = useActionState(resendVerification, {} as ResendActionState);
  const result = state.done === true ? state.result : null;

  return (
    <div className="flex flex-col gap-2">
      <form action={action}>
        <input type="hidden" name="proofId" value={proofId} />
        <button
          type="submit"
          className={
            subtle
              ? 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-amber-600 px-3 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50'
              : 'inline-flex min-h-10 items-center gap-2 rounded-xl border border-brand-600 px-3 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50'
          }
        >
          <RotateCcw aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          Get a fresh link
        </button>
      </form>

      {result ? <FreshLink result={result} /> : null}

      {state.error ? (
        <p role="alert" className="text-sm font-medium text-red-800">
          {state.error}
        </p>
      ) : null}
    </div>
  );
}

/** The shareable outcome of a resend, as the action returns it. */
type FreshLinkResult = {
  verificationUrl: string;
  verificationExpiresAt: string;
  verificationLinkSent: boolean;
};

/**
 * The fresh link, shown once. The token exists only in this response — the API
 * stores only its digest — so this is the only place it can be copied from.
 */
function FreshLink({ result }: { result: FreshLinkResult }) {
  const [copied, setCopied] = useState(false);

  async function copyLink(): Promise<void> {
    try {
      await navigator.clipboard.writeText(result.verificationUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused; the address is still on screen.
    }
  }

  return (
    <div className="rounded-xl border border-emerald-200/70 bg-emerald-50 p-3">
      <p className="text-sm text-emerald-900">
        Share this link with the person confirming your work{result.verificationLinkSent ? ' — again' : ''}.
      </p>
      <div className="mt-2 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-xs text-ink-800">
          {result.verificationUrl}
        </code>
        <button
          type="button"
          onClick={copyLink}
          aria-label="Copy the fresh link"
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700"
        >
          {copied ? (
            <Check aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          ) : (
            <Copy aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          )}
        </button>
      </div>
      <p className="mt-2 text-xs text-emerald-800">
        Stops working {expiresLabel(result.verificationExpiresAt)}.
      </p>
    </div>
  );
}

function expiresLabel(iso: string): string {
  const when = new Date(iso);
  const days = Math.ceil((when.getTime() - Date.now()) / 86_400_000);
  if (days <= 0) return `today at ${when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  if (days === 1) return 'tomorrow';
  return `in ${days} days`;
}