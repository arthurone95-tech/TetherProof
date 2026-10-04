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

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // The shared contracts package ships TypeScript sources in this workspace.
  transpilePackages: ['@tetherproof/shared'],
};

export default nextConfig;