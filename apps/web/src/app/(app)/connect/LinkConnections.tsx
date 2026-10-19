'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ExternalLink, Globe, Link2, Music2, Video } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { ICON_STROKE_WIDTH } from '@/components/ui/icon';

/**
 * One row per linkable source.
 *
 * `kind` is the whole design. Adding an integration later is one entry here and nothing
 * else — the card reads the discriminator and picks the presentation, so a new OAuth
 * provider does not mean a new layout, a new state shape or a second page.
 *
 * The order is deliberate: the working integration first, then the links people actually
 * use for work, then the ones that are named but unbuilt. Nothing in the last group is
 * clickable, because there is nothing behind it.
 */
type LinkSource = {
  id: string;
  label: string;
  blurb: string;
  icon: typeof Globe;
  /** Placeholder the URL field shows, so the expected shape is obvious. */
  example?: string;
  /** Hosts accepted. Empty means any http(s) URL. */
  hosts?: string[];
};

const SOURCES: LinkSource[] = [
  {
    id: 'website',
    label: 'Website',
    blurb: 'Your site or a page showing your work.',
    icon: Globe,
    example: 'https://yourbusiness.example',
  },
  {
    id: 'youtube',
    label: 'YouTube',
    blurb: 'A channel or a video of your work.',
    icon: Video,
    example: 'https://youtube.com/@yourchannel',
    hosts: ['youtube.com', 'www.youtube.com', 'youtu.be'],
  },
  {
    id: 'linkedin',
    label: 'LinkedIn',
    blurb: 'Your professional profile.',
    icon: Link2,
    example: 'https://linkedin.com/in/yourname',
    hosts: ['linkedin.com', 'www.linkedin.com'],
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    blurb: 'Where your trade is shown to the public.',
    icon: Music2,
    example: 'https://tiktok.com/@yourname',
    hosts: ['tiktok.com', 'www.tiktok.com'],
  },
];

/** Named but not built. Rendered as a list, never as a control. */
const COMING = [
  { label: 'GitLab', blurb: 'Same shape as GitHub, for people who keep their work there.' },
  { label: 'Instagram', blurb: 'Photos of completed jobs.' },
  { label: 'Facebook', blurb: 'For people whose clients find them there first.' },
  { label: 'X', blurb: 'Threads showing work in progress.' },
  { label: 'Behance', blurb: 'Design and fit-out work.' },
  { label: 'Dribbble', blurb: 'Design portfolios.' },
  { label: 'Vimeo', blurb: 'Video work, for trades that show rather than tell.' },
  { label: 'Pinterest', blurb: 'Mood boards and finished projects.' },
  { label: 'Twitch', blurb: 'Live demonstrations.' },
  { label: 'SoundCloud', blurb: 'Audio work — music, voice, sound design.' },
  { label: 'Google Business', blurb: 'Your public business listing.' },
];

/**
 * Reads a URL and checks it before it is stored.
 *
 * Validated on the way in for two reasons: a stored `javascript:` URL rendered into an
 * `href` would execute, and a stored garbage value is worse than no value because it looks
 * connected. Only `http` and `https` are accepted — a link is something somebody else
 * will open.
 */
function parseUrl(raw: string, hosts?: string[]): { ok: true; url: string } | { ok: false; reason: string } {
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
  if (hosts && !hosts.includes(parsed.hostname.toLowerCase())) {
    return { ok: false, reason: `Use a ${labelForHosts(hosts)} address.` };
  }

  return { ok: true, url: parsed.toString() };
}

function labelForHosts(hosts: string[]): string {
  return (hosts[0] ?? '').replace(/^www\./, '');
}

export function LinkConnections() {
  const [values, setValues] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<Record<string, string>>({});

  function save(id: string): void {
    const source = SOURCES.find((entry) => entry.id === id);
    if (!source) return;
    const result = parseUrl(values[id] ?? '', source.hosts);
    if (!result.ok) {
      setErrors((current) => ({ ...current, [id]: result.reason }));
      return;
    }
    setErrors((current) => ({ ...current, [id]: '' }));
    setSaved((current) => ({ ...current, [id]: result.url }));
  }

  return (
    <>
      <Card title="Link your work">
        <p className="text-sm text-ink-600">
          Add an address and we will show it beside your proof. We store the address only —
          nothing is signed in to and nothing is read automatically.
        </p>

        <ul className="mt-4 flex flex-col gap-4">
          {SOURCES.map((source) => {
            const Icon = source.icon;
            const savedUrl = saved[source.id];
            return (
              <li key={source.id} className="flex flex-col gap-2">
                <div className="flex items-start gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-ink-700">
                    <Icon aria-hidden="true" className="h-5 w-5" strokeWidth={ICON_STROKE_WIDTH} />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink-900">{source.label}</p>
                    <p className="text-xs text-ink-600">{source.blurb}</p>
                  </div>
                </div>

                {savedUrl ? (
                  <p className="flex items-center gap-2 pl-[3.25rem] text-xs text-ink-700">
                    <Link
                      href={savedUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                      className="inline-flex items-center gap-1 font-semibold text-brand-700 hover:text-brand-800"
                    >
                      {savedUrl.replace(/^https?:\/\//, '')}
                      <ExternalLink aria-hidden="true" className="h-3 w-3" strokeWidth={ICON_STROKE_WIDTH} />
                    </Link>
                    <button
                      type="button"
                      onClick={() =>
                        setSaved((current) => {
                          const next = { ...current };
                          delete next[source.id];
                          return next;
                        })
                      }
                      className="text-ink-600 underline hover:text-ink-900"
                    >
                      Remove
                    </button>
                  </p>
                ) : (
                  <div className="flex flex-col gap-1.5 pl-[3.25rem]">
                    <div className="flex flex-wrap gap-2">
                      <input
                        type="url"
                        inputMode="url"
                        value={values[source.id] ?? ''}
                        onChange={(event) =>
                          setValues((current) => ({ ...current, [source.id]: event.target.value }))
                        }
                        placeholder={source.example}
                        aria-label={`${source.label} address`}
                        className="min-h-11 min-w-0 flex-1 rounded-xl border border-brand-100 bg-white px-3 text-base text-ink-900 placeholder:text-ink-600/60"
                      />
                      <button
                        type="button"
                        onClick={() => save(source.id)}
                        className="min-h-11 rounded-xl border border-brand-600 px-4 text-sm font-semibold text-brand-700 transition-colors hover:bg-brand-50"
                      >
                        Add link
                      </button>
                    </div>
                    {errors[source.id] ? (
                      <p role="alert" className="text-xs font-semibold text-red-800">
                        {errors[source.id]}
                      </p>
                    ) : null}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card title="More connections">
        <p className="text-sm text-ink-600">
          Named here so you can ask for them. None of these is built yet, so none of them
          does anything.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {COMING.map((entry) => (
            <li
              key={entry.label}
              className="rounded-xl border border-dashed border-neutral-200 bg-neutral-50/60 p-3"
            >
              <p className="flex items-center gap-2 text-sm font-medium text-ink-700">
                {entry.label}
                <span className="rounded-full bg-neutral-200 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-ink-600">
                  Not yet
                </span>
              </p>
              <p className="mt-0.5 text-xs text-ink-600">{entry.blurb}</p>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

/** Re-exported for the icon map's type, so adding a source needs one import. */
export type { LinkSource };