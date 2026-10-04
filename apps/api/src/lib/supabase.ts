import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { env } from '../config/env.js';

/**
 * Supabase client for the API server.
 *
 * Uses the service-role key, which bypasses Row Level Security, so every
 * function that touches it must perform its own authorization. This module is
 * server-only: the key must never be bundled, logged, or returned to a client.
 */
export const supabaseAdmin: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/**
 * Supabase client for end-user authentication operations.
 *
 * Uses the anon key deliberately. Operations such as sending a one-time code
 * and exchanging it for a session are end-user flows, so they must run under
 * the same Row Level Security boundary a browser would get rather than
 * bypassing it with the service-role key. Never returns this client to a caller.
 */
export const supabaseAuth: SupabaseClient = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
    detectSessionInUrl: false,
  },
});

/**
 * Verifies a caller-supplied Supabase access token and returns the associated
 * user when it is valid and unexpired.
 *
 * Returns null rather than throwing so the auth middleware can answer with a
 * single 401 for every failure mode.
 */
export async function resolveUserFromAccessToken(accessToken: string) {
  const { data, error } = await supabaseAdmin.auth.getUser(accessToken);

  if (error || !data.user) return null;
  return data.user;
}

/** Reads a server-controlled role claim written by the API at registration. */
export function readRoleClaim(user: { app_metadata?: Record<string, unknown> }) {
  const role = user.app_metadata?.role;
  return typeof role === 'string' ? role : null;
}
