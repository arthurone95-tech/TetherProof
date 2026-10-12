import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { NextConfig } from 'next';

/**
 * Public browser configuration read by the Supabase clients in
 * `src/lib/supabase/*`. These are not secrets: browser access is controlled by
 * Row Level Security, not by hiding them.
 */
const REQUIRED_PUBLIC_ENV = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

/**
 * Locates the single repository-root `.env`.
 *
 * Next.js only loads `.env*` files from its own project directory (`apps/web`),
 * so the root file that configures every other workspace is invisible here and
 * the Supabase clients are constructed with empty strings. This walks upward to
 * find it, keeping one source of configuration across the monorepo. This is the
 * same fix the API applies in `src/config/load-env.ts`, logged as E-004.
 */
function findRootEnvFile(): string | undefined {
  const startPoints = [process.cwd(), typeof __dirname === 'string' ? __dirname : undefined];

  for (const start of startPoints) {
    if (!start) continue;

    let directory = resolve(start);
    for (let depth = 0; depth < 6; depth += 1) {
      const candidate = join(directory, '.env');
      if (existsSync(candidate)) return candidate;

      const parent = dirname(directory);
      if (parent === directory) break;
      directory = parent;
    }
  }

  return undefined;
}

const rootEnvFile = findRootEnvFile();

if (rootEnvFile) {
  // `next dev` and `next build` pin the mode before this file is evaluated. The
  // root `.env` sets NODE_ENV=development for the API tooling; letting that
  // through would reintroduce the `/404` prerender failure recorded as E-005.
  //
  // `process.loadEnvFile` leaves already-defined variables untouched, which
  // normally makes the restore below a no-op. It is kept so the guarantee does
  // not depend on that behaviour staying true.
  const nodeEnvBeforeLoad = process.env.NODE_ENV;
  process.loadEnvFile(rootEnvFile);

  if (nodeEnvBeforeLoad !== undefined && process.env.NODE_ENV !== nodeEnvBeforeLoad) {
    // NODE_ENV is typed as read-only; the mode genuinely must be restored.
    (process.env as Record<string, string | undefined>).NODE_ENV = nodeEnvBeforeLoad;
  }
}

const missingPublicEnv = REQUIRED_PUBLIC_ENV.filter((key) => !process.env[key]);

if (missingPublicEnv.length > 0) {
  throw new Error(
    [
      `Missing required configuration: ${missingPublicEnv.join(', ')}.`,
      rootEnvFile
        ? `These must be set in ${rootEnvFile}.`
        : 'No .env file was found in the repository or any parent directory.',
      'Copy .env.example to .env and fill it in, or supply them as environment variables.',
    ].join(' '),
  );
}

/**
 * Response headers for every page the web app serves.
 *
 * The API has carried a full `helmet` set since Phase 1 and the client had
 * none, which leaves the half of the application that actually renders forms
 * and holds the session cookie less defended than the JSON behind it: the
 * rendered page could be framed by any site (so a sign-in or log-work form
 * could be overlaid and clicked from elsewhere), and a response with no
 * declared type is one MIME-sniffing mistake away from being treated as
 * executable.
 *
 * `X-Frame-Options: SAMEORIGIN` rather than `DENY`, matching the API: a
 * same-origin frame is how the layout is inspected at a desktop width when no
 * wide viewport is available, and `DENY` would close that without protecting
 * anything `frame-ancestors 'self'` does not.
 *
 * `Referrer-Policy: no-referrer` because a verification link carries a bearer
 * token in its path. Any referrer that leaks the URL leaks the token, and
 * nothing in this product needs to tell another site where a reader came from.
 * The verify page asked for this with a meta tag; it is now true everywhere.
 *
 * **No `script-src`, deliberately.** Next bootstraps hydration from inline
 * scripts, so a strict script policy needs a per-request nonce threaded through
 * middleware — a change that breaks pages in ways a header check cannot see.
 * The directives below are the ones that are safe to assert now; each is
 * independent, so a browser applies them and leaves the rest alone. A nonce is
 * the right next step for `script-src`, and belongs in its own change.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'no-referrer' },
  // The app asks for the reader's position (to check a work site), their
  // microphone (to record a voice note) and, on a phone, the camera behind the
  // photo picker. Each is granted to this origin only — a page embedded in
  // another site gets none of them.
  { key: 'Permissions-Policy', value: 'geolocation=(self), microphone=(self), camera=(self)' },
  {
    key: 'Content-Security-Policy',
    value: "frame-ancestors 'self'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  // Meaningful only over HTTPS, which is what a deployment speaks; ignored on
  // plain http in development, so it is safe to state unconditionally.
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The header names the framework on every response for no benefit.
  poweredByHeader: false,
  // The shared contracts package ships TypeScript sources in this workspace.
  transpilePackages: ['@tetherproof/shared'],
  experimental: {
    serverActions: {
      bodySizeLimit: '25mb',
    },
  },
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ];
  },
  /**
   * Same-origin mirror of the API's public surface.
   *
   * The GitHub OAuth callback has to be a URL the provider can send the
   * browser back to through the *public* web origin (`WEB_BASE_URL`), and the
   * API has no public origin of its own in a typical deployment. Rewriting the
   * `/api/v1` prefix onto the API keeps that callback real without the browser
   * needing to know a second host. Nothing signed-in changes: the app's
   * authenticated calls travel server-side with the session cookie, and this
   * rewrite merely adds a path the public endpoints can also be reached at.
   */
  async rewrites() {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE_URL;
    if (!apiBase) return [];
    return [{ source: '/api/v1/:path*', destination: `${apiBase}/api/v1/:path*` }];
  },
};

export default nextConfig;