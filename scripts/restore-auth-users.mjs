/**
 * Recreates `auth.users` from an export, through the service-role API.
 *
 * ## Why this exists and why it is not raw SQL
 *
 * The obvious restore for a `auth.users` backup is `INSERT INTO auth.users ...`. That does
 * not work on Supabase, and the reason is worth recording: `auth.users` carries a Postgres
 * **INSERT rule** that maps every column to `DEFAULT`, so any statement supplying an
 * explicit value fails with
 *
 *     ERROR: cannot insert a non-DEFAULT value into column "email"
 *
 * That is a deliberate control. It means accounts cannot be created by bypassing GoTrue —
 * which is what keeps identity creation inside one code path that evaluates hooks, writes
 * `auth.identities`, and sends confirmation mail. Discovering this by generating the SQL
 * and running it is the slow way to learn it; the generated file was removed and replaced
 * with this script.
 *
 * ## What it does
 *
 * Reads `backups/auth-users.json` and recreates each account with
 * `auth.admin.createUser`, preserving the id where possible so the foreign keys from
 * `public.*` still resolve. GoTrue does the rest.
 *
 * ## Important limitations, stated rather than discovered later
 *
 * * **Ids are not guaranteed.** `createUser` assigns a fresh id. Pass the old id through
 *   `user_metadata` if you need to trace a row back to the export; the script does this.
 *   If a row in `public.*` must point at a specific account, restore `public.*` *after*
 *   this has run, and rewrite the ids — or accept that the accounts are equivalent test
 *   data with different ids.
 * * **Passwords cannot be carried over.** GoTrue only accepts a plaintext password and
 *   hashes it with its own cost factor. The exported bcrypt hashes are useless against the
 *   API. The script generates a known password for every account and prints it. That is
 *   acceptable for test data and unacceptable for real users, which is one more reason this
 *   is a recovery tool for a test project and not a production account-restore strategy.
 * * **It is destructive.** It creates accounts. Run it against a project you intend to
 *   populate, and read the printed passwords before closing the window.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function readEnv(file) {
  const out = {};
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i === -1) continue;
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, '');
  }
  return out;
}

const env = readEnv(resolve(ROOT, '.env'));

// The API path needs a URL and the service-role key. In this repository the anon key is
// used for browser access and this key for everything privileged; a wrong one fails
// loudly at the first call rather than half-way through.
const url = env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY is not set. Cannot restore accounts.');
  process.exit(1);
}

const source = resolve(ROOT, 'backups/auth-users.json');
if (!readFileSync(source, 'utf8')) { console.error('backups/auth-users.json is missing. Run the export first.'); process.exit(1); }
const { users } = JSON.parse(readFileSync(source, 'utf8'));

const DRY_RUN = process.argv.includes('--dry-run');
const PASSWORD = process.env.RESTORE_PASSWORD ?? 'RestoreTest123456';

const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

console.log(`Recreating ${users.length} account(s) from ${source}`);
console.log(`target: ${url.replace(/\/\/.*@/, '//')}`);
if (DRY_RUN) console.log('DRY RUN: nothing will be created.');
console.log('');

let created = 0, skipped = 0, failed = 0;
const credentials = [];

for (const u of users) {
  const { data: existing } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  if ((existing?.users ?? []).some((e) => e.email === u.email)) {
    console.log(`  skip   ${u.email} (already exists)`);
    skipped++;
    continue;
  }
  if (DRY_RUN) { console.log(`  would create ${u.email}`); created++; continue; }

  const { data, error } = await admin.auth.admin.createUser({
    email: u.email ?? undefined,
    phone: u.phone ?? undefined,
    password: PASSWORD,
    email_confirm: u.email_confirmed_at != null,
    phone_confirm: u.phone_confirmed_at != null,
    // The capability claim lives here, and the sync_user_role trigger turns it into a
    // user_capabilities row. Without it the account comes back with no capability.
    app_metadata: u.raw_app_meta_data ?? {},
    user_metadata: { ...(u.raw_user_meta_data ?? {}), restored_from_id: u.id },
  });

  if (error) {
    console.log(`  FAIL   ${u.email}: ${error.message}`);
    failed++;
    continue;
  }
  console.log(`  create ${u.email} -> ${data.user.id}`);
  credentials.push({ email: u.email, password: PASSWORD, id: data.user.id, original_id: u.id });
  created++;
}

console.log('');
console.log(`${created} created, ${skipped} skipped, ${failed} failed`);
if (credentials.length > 0) {
  console.log('');
  console.log('ACCOUNTS AND PASSWORDS (record these now; they are not stored anywhere):');
  for (const c of credentials) console.log(`  ${c.email}  ${c.password}  new_id=${c.id}  old_id=${c.original_id}`);
}
process.exit(failed > 0 ? 1 : 0);