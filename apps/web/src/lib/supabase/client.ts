import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client for TetherProof.
 *
 * Uses the anon key, which is public by design. It can only read what the
 * signed-in user is allowed to read, because every table is protected by Row
 * Level Security.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL ?? '',
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '',
  );
}
