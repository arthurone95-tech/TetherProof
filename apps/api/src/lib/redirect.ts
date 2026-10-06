import { z } from 'zod';
import { env } from '../config/env.js';
import { isLocalAddress } from './origin.js';

/**
 * Where a confirmation link is allowed to send the person who taps it.
 *
 * Supabase Auth builds the link from a `redirect_to` supplied at the moment the
 * code is requested, and falls back to the project's Site URL — a fixed address
 * configured once in the dashboard — when none is. That fallback pointed at
 * `http://localhost:3000` while the application was running on 3001, so every
 * confirmation link left the application and landed somewhere else entirely. The
 * address therefore travels with the request that asks for the code.
 *
 * **Letting any caller name it would be an open redirect carrying a session.**
 * An attacker who requested a code for somebody else's address would otherwise
 * be able to send that person a Supabase-hosted link which, when tapped, hands
 * the resulting access and refresh tokens to a host the attacker controls. So
 * the value is restricted to origins this deployment already names, plus
 * loopback addresses while developing, and refused otherwise rather than
 * quietly dropped: a silent fallback is how the wrong-origin bug survived for as
 * long as it did.
 */

/**
 * Origins named by configuration.
 *
 * Read from every variable that already declares where the web client lives, so
 * a deployment that sets any one of them works without also setting the others.
 * A value that cannot be parsed is skipped: a malformed entry must not stop the
 * server booting, and the consequence — a confirmation link refused with a
 * field-level reason — is the loud failure this module exists to produce.
 */
function configuredOrigins(): Set<string> {
  const candidates = [env.NEXT_PUBLIC_SITE_URL, env.WEB_BASE_URL, ...env.corsOrigins];

  const origins = new Set<string>();
  for (const candidate of candidates) {
    const value = candidate.trim();
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Skipped; the operator's own configuration error surfaces as a refusal.
    }
  }
  return origins;
}

/**
 * Returns why `value` cannot receive a confirmation link, or null when it can.
 *
 * Written as a plain function rather than only as Zod checks so the rule can be
 * asserted directly, and so the same sentence is reused wherever the value is
 * examined.
 */
export function redirectOriginProblem(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'Enter a full server address, such as https://example.com.';
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return 'Only http and https addresses can receive a confirmation link.';
  }

  // A username or password in the authority would be sent to Supabase as part of
  // the address, and has no legitimate use here.
  if (url.username !== '' || url.password !== '') {
    return 'An address with embedded credentials cannot receive a confirmation link.';
  }

  // The value is joined to `/auth/callback`, so anything after the authority
  // would produce a link to a path nobody wrote.
  if ((url.pathname !== '' && url.pathname !== '/') || url.search !== '' || url.hash !== '') {
    return 'Give the server address only, without a path.';
  }

  if (configuredOrigins().has(url.origin)) return null;
  // Outside production, the developer's own network — see `lib/origin.ts`.
  if (!env.isProduction && isLocalAddress(url.hostname)) return null;

  return 'This address is not permitted to receive confirmation links.';
}

/**
 * The origin a confirmation link may return to, as accepted by the API.
 *
 * `.trim()` before the check so a value pasted with surrounding whitespace is
 * judged on what it says rather than on how it was copied, and a normalising
 * `.transform` after it so what reaches `deliverCode` is `URL.origin` exactly —
 * no path, no fragment, no casing that survived validation by parsing
 * differently than it reads. Building the callback address from a value the
 * schema has already reduced to its authority removes any way for the string
 * and its parsed form to disagree.
 */
export const redirectOriginSchema = z
  .string()
  .trim()
  .max(300)
  .superRefine((value, ctx) => {
    const problem = redirectOriginProblem(value);
    if (problem !== null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
    }
  })
  .transform((value) => new URL(value).origin);

/**
 * The address Supabase Auth redirects to after a confirmation link is tapped.
 *
 * `/auth/callback` is the route in the web client that turns the tokens Supabase
 * hands back into the application's own session cookie. The path is fixed by
 * that route; only the origin varies.
 */
export function confirmationCallbackUrl(origin: string): string {
  return `${origin.replace(/\/+$/, '')}/auth/callback`;
}
