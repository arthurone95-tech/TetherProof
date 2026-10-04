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
