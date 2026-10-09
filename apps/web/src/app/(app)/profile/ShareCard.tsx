'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

interface ShareCardProps {
  /** Whether the public capability page exists for this account. */
  enabled: boolean;
  /** The unguessable address of the page; null while the page is disabled. */
  slug: string | null;
}

/**
 * The shareable capability page: what a worker can hand to anyone.
 *
 * The page is off until the worker turns it on in privacy settings, so this
 * card either points at the settings that control it or shows the address to
 * share. The public page is deliberately thin — only the skill aggregates a
 * stranger is entitled to see — and the note says so, because "share your
 * proof" could otherwise read as "publish everything".
 *
 * The copy button builds the full address in the browser, from the origin the
 * visitor is actually on. The server does not know which alias the deployment
 * was reached through, and the browser does, which is the same reason every
 * link this app sends is built from the request's own origin.
 */
export function ShareCard({ enabled, slug }: ShareCardProps) {
  const [copied, setCopied] = useState(false);
  const href = enabled && slug ? `/share/${slug}` : null;

  async function copyLink(): Promise<void> {
    if (!href) return;
    const url = `${window.location.origin}${href}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be refused (permissions, embedded contexts). The
      // address is still on screen for a long-press copy, so nothing is lost.
    }
  }

  if (!href) {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-sm text-ink-600">
          Your capability page is off. Turn it on in Privacy settings to get a link anyone can
          open — it shows only the skills you have verified, never your media, location, or contact
          details.
        </p>
        <Link
          href="/settings/privacy"
          className="inline-flex min-h-11 items-center justify-center rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
        >
          Manage privacy
        </Link>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-emerald-200/70 bg-emerald-50 p-4">
      <p className="text-sm text-emerald-900">
        Anyone with this link can view your verified capability profile. It shows only the skills
        you have proven — no media, no location, no contact details.
      </p>
      <div className="mt-3 flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-3 py-2 text-sm text-ink-800">
          {href}
        </code>
        <button
          type="button"
          onClick={copyLink}
          aria-label="Copy the link to your capability page"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand-600 text-white transition-colors hover:bg-brand-700"
        >
          {copied ? (
            <Check aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          ) : (
            <Copy aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
          )}
        </button>
      </div>
      <p className="mt-3 text-sm text-ink-600">
        Turn the page off any time in{' '}
        <Link href="/settings/privacy" className="font-semibold text-brand-700 hover:text-brand-800">
          Privacy settings
        </Link>
        .
      </p>
    </div>
  );
}