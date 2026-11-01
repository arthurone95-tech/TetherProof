'use client';

import { useEffect, useState, useTransition } from 'react';
import Link from 'next/link';
import { ExternalLink, Plus } from 'lucide-react';
import type { WorkerLink } from '@tetherproof/shared';
import { addWorkerLink, removeWorkerLink } from '@/lib/actions';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

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

export function LinkConnections({ initialLinks }: { initialLinks: WorkerLink[] }) {
  const [links, setLinks] = useState<WorkerLink[]>(initialLinks);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [error, setError] = useState('');
  const [pending, startTransition] = useTransition();

  // Keep the list in step with the server after an add or remove revalidates
  // the route. Without this the client's copy would stay stale.
  useEffect(() => {
    setLinks(initialLinks);
  }, [initialLinks]);

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
    setError('');
    startTransition(async () => {
      const outcome = await addWorkerLink(trimmedName, result.url);
      if (outcome.ok) {
        setLinks((current) => [outcome.link, ...current]);
        setName('');
        setUrl('');
      } else {
        setError(outcome.error);
      }
    });
  }

  function remove(id: string): void {
    startTransition(async () => {
      const outcome = await removeWorkerLink(id);
      if (outcome.ok) {
        setLinks((current) => current.filter((link) => link.id !== id));
      } else {
        setError(outcome.error);
      }
    });
  }

  return (
    <Card title="Link your work">
      <p className="text-sm text-ink-600">Addresses shown beside your proof.</p>
      {links.length > 0 ? (
        <ul className="flex flex-col gap-2">
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
                disabled={pending}
                aria-label={`Remove ${link.name}`}
                className="shrink-0 text-xs text-ink-600 underline hover:text-ink-900 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-600">No links yet.</p>
      )}

      <div className="mt-4 flex flex-col gap-2">
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <label htmlFor="link-name" className="mb-1 block text-xs font-medium text-ink-600">Name</label>
            <input
              id="link-name"
              type="text"
              list="link-name-presets"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. YouTube"
              aria-label="Link name"
              className="min-h-11 w-full rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
            />
            <datalist id="link-name-presets">
              {NAME_PRESETS.map((preset) => (
                <option key={preset} value={preset} />
              ))}
            </datalist>
          </div>
          <button
            type="button"
            onClick={add}
            disabled={pending}
            className="inline-flex min-h-11 items-center gap-1 rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50 disabled:opacity-50"
          >
            <Plus aria-hidden="true" className="h-4 w-4" strokeWidth={ICON_STROKE_WIDTH} />
            {pending ? 'Saving…' : 'Add link'}
          </button>
        </div>
        <div>
          <label htmlFor="link-url" className="mb-1 block text-xs font-medium text-ink-600">Address</label>
          <input
            id="link-url"
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://..."
            aria-label="Link address"
            className="min-h-11 w-full rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
          />
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
