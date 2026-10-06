import { headers } from 'next/headers';

/**
 * The origin the browser is actually using.
 *
 * Confirmation links are built from this rather than from a port hardcoded
 * somewhere, because a local server picks whichever port is free — 3000 on one
 * machine, 3001 on the next — and a link written against the wrong one lands on
 * a completely different application. `origin` is the header form of
 * `window.origin`: the browser sets it to the page the person is on, so it is
 * the one value that cannot drift from reality.
 */

/** The subset of `ReadonlyHeaders` this needs, so the rule can be tested off-request. */
interface HeaderSource {
  get(name: string): string | null;
}

/** Takes the first value of a possibly comma-joined header, as proxies send them. */
function firstValue(value: string | null): string | null {
  if (!value) return null;
  const first = value.split(',')[0]?.trim();
  return first ? first : null;
}

/**
 * The bare origin of `value`, or null when it is not a usable http address.
 *
 * `URL.origin` drops any path, query, and fragment, so this returns the server
 * address however the input was written. A `javascript:` or `data:` scheme, or
 * an address carrying credentials, is refused rather than passed on to become
 * part of a link.
 */
function originOf(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    if (url.username !== '' || url.password !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * Resolves the origin in priority order: explicit configuration, then the origin
 * the request came from, then the host it was addressed to.
 *
 * Configuration wins when it is set, so a deployed site always writes one
 * canonical address into every link it sends no matter which alias a visitor
 * arrived through — which is also the shortest list to keep in sync with
 * Supabase's own redirect allow-list. A configured value that cannot be parsed
 * is skipped rather than fatal: the request's own origin is still the right
 * answer, and refusing to register someone over a stray space in `.env` would be
 * a worse trade than using the address we know is correct.
 */
export function originFrom(source: HeaderSource, configured?: string | null): string | null {
  const explicit = configured?.trim();
  if (explicit) {
    const origin = originOf(explicit);
    if (origin) return origin;
  }

  const declared = firstValue(source.get('origin'));
  if (declared) {
    const origin = originOf(declared);
    if (origin) return origin;
  }

  const protocol = firstValue(source.get('x-forwarded-proto')) ?? 'http';
  const host = firstValue(source.get('x-forwarded-host')) ?? firstValue(source.get('host'));
  if (!host) return null;

  return originOf(`${protocol}://${host}`);
}

/** Resolves the origin for the request now being handled. */
export async function currentOrigin(): Promise<string | null> {
  return originFrom(await headers(), process.env.NEXT_PUBLIC_SITE_URL);
}
