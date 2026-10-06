'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { completeAuthCallback, completeAuthFromCode } from '@/lib/actions';
import type { AuthCallbackResult } from '@/lib/form-state';
import { Banner } from '@/components/ui/Banner';
import { Card } from '@/components/ui/Card';

/**
 * Told to the reader when a link carried no usable credentials at all — someone
 * who typed the address, or a provider that redirected without a session.
 */
const NOTHING_TO_CONFIRM =
  'There is nothing to confirm on this page. Open the link in your confirmation message, or request a new code.';

/** Told to the reader when credentials were present and Supabase would not accept them. */
const NOT_ACCEPTED =
  'That sign-in link could not be used. It may have expired or already been opened. Request a new code and try again.';

/**
 * Reads the credentials out of the address bar and turns them into a session.
 *
 * The two shapes a confirmation link can arrive in are handled here rather than
 * in the server: Supabase sends the implicit-flow session as a URL fragment,
 * and a fragment is never transmitted to a server, so nothing server-side can
 * see it. Each shape is handed to the action that knows how to validate it, and
 * both answer with somewhere to go or with the reason they could not.
 *
 * The credentials are read and then immediately rewritten out of the address
 * bar, before any network call, so they are not left sitting in history, in a
 * screenshot, or in a URL somebody pastes somewhere.
 */
export function CallbackFinisher() {
  const [error, setError] = useState<string | null>(null);

  /**
   * Guards against the effect running twice.
   *
   * React runs effects twice in development, and a second run would replay the
   * same refresh token against Supabase — which rotates the token on first use,
   * so the replay would be refused and the reader would be shown a failure for a
   * sign-in that had already succeeded. The result of the one run that matters
   * is acted on regardless of whether the component is still mounted.
   */
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const query = new URLSearchParams(window.location.search);

    const refreshToken = hash.get('refresh_token');
    const code = query.get('code');
    const refused =
      hash.get('error_description') ??
      hash.get('error') ??
      query.get('error_description') ??
      query.get('error');

    if (window.location.hash !== '' || window.location.search !== '') {
      window.history.replaceState(null, '', window.location.pathname);
    }

    const finish = async (): Promise<void> => {
      let result: AuthCallbackResult | null;

      if (refreshToken) {
        result = await completeAuthCallback(refreshToken).catch(() => null);
      } else if (code) {
        result = await completeAuthFromCode(code).catch(() => null);
      } else {
        setError(refused ? NOT_ACCEPTED : NOTHING_TO_CONFIRM);
        return;
      }

      if (!result) {
        setError(NOT_ACCEPTED);
        return;
      }
      if (!result.ok) {
        setError(result.error);
        return;
      }

      /**
       * A full page load rather than a client-side navigation. The session
       * cookie was written by the action that just resolved, and the first
       * request to carry it should be a plain page render, so the destination
       * renders under the same conditions as any later visit to it.
       */
      window.location.assign(result.landing);
    };

    void finish();
  }, []);

  if (error === null) {
    return (
      <Card>
        <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">TetherProof</p>
        <h1 className="mt-2 text-2xl font-bold text-ink-900">Signing you in</h1>
        <p className="mt-4 text-ink-600" role="status">
          Confirming your account and opening your workspace.
        </p>
      </Card>
    );
  }

  return (
    <Card>
      <p className="text-sm font-semibold tracking-wide text-brand-600 uppercase">TetherProof</p>
      <h1 className="mt-2 text-2xl font-bold text-ink-900">That link did not work</h1>
      <div className="mt-4">
        <Banner tone="problem" title="Sign-in link not accepted">
          {error}
        </Banner>
      </div>
      <p className="mt-6">
        <Link
          href="/login"
          className="font-semibold text-brand-600 underline underline-offset-4"
        >
          Go to sign in
        </Link>
      </p>
    </Card>
  );
}
