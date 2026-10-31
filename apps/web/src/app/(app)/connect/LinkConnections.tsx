'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Plus } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

/**
 * A link the worker attached to their account. Stored client-side for now;
 * persistence to the account is a separate piece of work (see the report).
 */
type SavedLink = { id: string; name: string; url: string };

/**
 * Names offered as quick picks. A worker is never limited to these: the name
 * field is free text with a type-ahead list, so anything not here can simply be
 * typed in (a client's own site, a portfolio, a tool nobody else uses). The
 * list is a convenience, not a gate — which is the whole point of one flow
 * instead of one box per service.
 */
const NAME_PRESETS = [
  'Website',
  'Portfolio',
  'YouTube',
  'LinkedIn',
  'TikTok',
  'Instagram',
  'Facebook',
  'X',
  'GitHub',
  'GitLab',
  'Behance',
  'Dribbble',
  'Vimeo',
  'Pinterest',
  'Twitch',
  'SoundCloud',
  'Google Business',
  'Medium',
  'Substack',
];

function parseUrl(raw: string): { ok: true; url: string } | { ok: false; reason: string } {
  const value = raw.trim();
  if (!value) return { ok: false, reason: 'Enter an address.' };
  if (value.length > 300) return { ok: false, reason: 'That address is too long.' };

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, reason: 'That does not look like an address. It should start with https://' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'Only http and https addresses can be linked.' };
  }
  if (!parsed.hostname.includes('.')) {
    return { ok: false, reason: 'That address has no website in it.' };
  }

  return { ok: true, url: parsed.toString() };
}

export function LinkConnections() {
  const [links, setLinks] = useState<SavedLink[]>([]);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');

  function add(): void {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError('Give the link a name.');
      return;
    }
    const result = parseUrl(url);
    if (!result.ok) {
      setError(result.reason);
      return;
    }
    setLinks((current) => [
      ...current,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: trimmedName, url: result.url },
    ]);
    setName('');
    setUrl('');
    setError('');
  }

  function remove(id: string): void {
    setLinks((current) => current.filter((link) => link.id !== id));
  }

  return (
    <Card title="Link your work">
      <p className="text-sm text-ink-600">
        Add an address and we will show it beside your proof. We store the address only — nothing
        is signed in to and nothing is read automatically. Give each link a name so an employer
        knows what it is.
      </p>

      {links.length > 0 ? (
        <ul className="mt-4 flex flex-col gap-2">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-brand-100 p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink-900">{link.name}</p>
                <Link
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  className="inline-flex items-center gap-1 text-xs font-semibold text-brand-700 hover:text-brand-800"
                >
                  {link.url.replace(/^https?:\/\//, '')}
                  <ExternalLink aria-hidden="true" className="h-3 w-3" strokeWidth={ICON_STROKE_WIDTH} />
                </Link>
              </div>
              <button
                type="button"
                onClick={() => remove(link.id)}
                aria-label={`Remove ${link.name}`}
                className="shrink-0 text-xs text-ink-600 underline hover:text-ink-900"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex flex-wrap gap-2">
          <input
            type="text"
            list="link-name-presets"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Name (e.g. YouTube)"
            aria-label="Link name"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
          />
          <datalist id="link-name-presets">
            {NAME_PRESETS.map((preset) => (
              <option key={preset} value={preset} />
            ))}
          </datalist>
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
            aria-label="Link address"
            className="min-h-11 min-w-0 flex-1 rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
          />
          <button
            type="button"
            onClick={add}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
          >
            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
            Add link
          </button>
        </div>
        {error ? (
          <p role="alert" className="text-xs font-semibold text-red-800">
            {error}
          </p>
        ) : null}
      </div>
    </Card>
  );
}
