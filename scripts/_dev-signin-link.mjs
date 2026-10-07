#!/usr/bin/env node
/**
 * Dev helper: mint a confirmation sign-in link for a test address without an
 * email actually being delivered.
 *
 * The project's sign-up flow proves ownership of the email address before the
 * account can sign in. Email delivery depends on the Supabase project's quota,
 * which is rate-limited, so local and flow testing use this instead: it asks
 * Supabase for the same signup link a real email would carry and prints it,
 * ready to paste into a browser or hand to a test worker account.
 *
 *   node scripts/_dev-signin-link.mjs flowtest.worker.20261007@tetherproof.invalid
 *
 * Reads SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the root .env, exactly
 * like the other scripts in this directory.
 */

import { config as loadDotenv } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadDotenv({ path: join(ROOT, '.env') });

const email = process.argv[2];
if (!email) {
  console.error('usage: node scripts/_dev-signin-link.mjs <email>');
  process.exit(2);
}

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
  process.exit(1);
}

const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const { data, error } = await admin.auth.admin.generateLink({ type: 'signup', email });

if (error) {
  console.error(`could not mint a signup link: ${error.message}`);
  process.exit(1);
}

const token = data?.properties?.hashed_token;
if (!token) {
  console.error('Supabase returned a signup link without a hashed_token.');
  process.exit(1);
}

console.log(`${process.env.SUPABASE_URL}/auth/v1/verify?token=${encodeURIComponent(token)}&type=signup`);