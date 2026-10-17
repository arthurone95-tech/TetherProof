/**
 * Exports the live TetherProof database to a restorable set of files.
 *
 * Written because `pg_dump` is not available in this environment and because the useful
 * thing to preserve here is the *data*, not the schema: the schema is fully reproducible
 * by replaying `apps/api/drizzle/*.sql` in journal order, which is a stronger guarantee
 * than a dump of the current shape (a dump of the current shape is a snapshot of whatever
 * bugs are currently present in it).
 *
 * What is produced, under `backups/`:
 *
 *   schema-manifest.json    Tables, columns, types, enums, foreign keys, indexes, RLS
 *                           state, policies and triggers. Documentation and the thing you
 *                           diff against after a restore to prove the shape came back.
 *   data-public.json        Every row of every `public.*` table, verbatim.
 *   restore-public.sql      The same rows as INSERT statements, dependency-ordered, with
 *                           `ON CONFLICT DO NOTHING` so the script is safe to re-run.
 *   auth-users.json         `auth.users` and `auth.identities`, for reference.
 *   restore-auth-users.sql  Raw SQL to reinsert them, with the caveats that matter.
 *   MANIFEST.txt            Row counts and checksums, written last.
 *
 * The export directory is gitignored. It contains password hashes and tokens; it is a
 * recovery artefact, not something to commit.
 */
import { Client } from 'pg';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'backups');
mkdirSync(OUT, { recursive: true });

/** Parses a `.env` file into a plain object. Values are read, never printed. */
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

const db = new Client({ connectionString: env.DATABASE_URL, ssl: { rejectUnauthorized: false } });

/** Postgres literal. Everything becomes a quoted literal and Postgres coerces on insert. */
function lit(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : 'NULL';
  if (v instanceof Date) return `'${v.toISOString()}'::timestamptz`;
  const s = typeof v === 'object' ? JSON.stringify(v) : String(v);
  return `'${s.replace(/'/g, "''")}'`;
}
const ident = (s) => `"${s.replace(/"/g, '""')}"`;

const sum = (s) => createHash('sha256').update(s).digest('hex');
const log = [];
function say(line) { console.log(line); log.push(line); }

await db.connect();

say('TetherProof database export');
say(`generated at (UTC): ${new Date().toISOString()}`);
say('='.repeat(64));

// ---------------------------------------------------------------- schema manifest
const tables = (await db.query(
  `select table_name from information_schema.tables
    where table_schema='public' and table_type='BASE TABLE' order by table_name`,
)).rows.map((r) => r.table_name);

const columns = (await db.query(
  `select table_name, column_name, data_type, udt_name, is_nullable, column_default, ordinal_position
     from information_schema.columns where table_schema='public'
    order by table_name, ordinal_position`,
)).rows;

const enums = (await db.query(
  `select t.typname, e.enumlabel, e.enumsortorder
     from pg_type t join pg_namespace n on n.oid=t.typnamespace
     join pg_enum e on e.enumtypid=t.oid
    where n.nspname='public' order by t.typname, e.enumsortorder`,
)).rows;

const foreignKeys = (await db.query(
  `select conrelid::regclass::text as table_name, conname, pg_get_constraintdef(oid) as definition
     from pg_constraint where contype='f' and connamespace='public'::regnamespace
    order by table_name, conname`,
)).rows;

const indexes = (await db.query(
  `select tablename, indexname, indexdef from pg_indexes
    where schemaname='public' order by tablename, indexname`,
)).rows;

const rls = (await db.query(
  `select c.relname, c.relrowsecurity, c.relforcerowsecurity
     from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relkind='r' order by c.relname`,
)).rows;

const policies = (await db.query(
  `select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
     from pg_policies where schemaname='public' order by tablename, policyname`,
)).rows;

const triggers = (await db.query(
  `select event_object_schema as schema, event_object_table as table, trigger_name,
          action_timing, event_manipulation, action_statement
     from information_schema.triggers where event_object_schema in ('public','auth')
    order by event_object_table, trigger_name`,
)).rows;

const functions = (await db.query(
  `select p.proname, pg_get_functiondef(p.oid) as definition
     from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='public' and p.prokind='f' order by p.proname`,
)).rows;

writeFileSync(
  resolve(OUT, 'schema-manifest.json'),
  JSON.stringify({ generatedAt: new Date().toISOString(), tables, columns, enums, foreignKeys, indexes, rls, policies, triggers, functions }, null, 2),
);
say(`schema-manifest.json   ${tables.length} tables, ${enums.length} enum labels, ${policies.length} policies`);

// ---------------------------------------------------------------- public data
const data = {};
for (const t of tables) {
  data[t] = (await db.query(`select * from public.${ident(t)}`)).rows;
}
writeFileSync(resolve(OUT, 'data-public.json'), JSON.stringify({ generatedAt: new Date().toISOString(), tables: data }, null, 2));

const totalRows = Object.values(data).reduce((n, r) => n + r.length, 0);
say(`data-public.json       ${totalRows} rows across ${tables.length} tables`);

// ---------------------------------------------------------------- restore SQL
// Dependency order: users first, then everything else in alphabetical order. Every
// reference in this schema points at users(id), so one level of ordering is enough — and
// ON CONFLICT DO NOTHING makes the script safe to run against a database that already has
// the data, which is the situation it will most often be run in.
const order = ['users', ...tables.filter((t) => t !== 'users').sort()];
const sqlParts = [
  '-- TetherProof public data restore.',
  '-- Generated by scripts/export-database.mjs. Safe to re-run.',
  '--',
  '-- This restores DATA only. It assumes the schema already exists, which is',
  '-- reproducible by replaying apps/api/drizzle/*.sql in journal order. If the',
  '-- schema is what was lost, run the migrations instead of this file.',
  '',
];
for (const t of order) {
  const rows = data[t];
  if (!rows || rows.length === 0) continue;
  const cols = Object.keys(rows[0]);
  const colList = cols.map(ident).join(', ');
  sqlParts.push(`-- ${t} (${rows.length} rows)`);
  for (const row of rows) {
    const values = cols.map((c) => lit(row[c])).join(', ');
    sqlParts.push(`INSERT INTO public.${ident(t)} (${colList}) VALUES (${values}) ON CONFLICT DO NOTHING;`);
  }
  sqlParts.push('');
}
writeFileSync(resolve(OUT, 'restore-public.sql'), sqlParts.join('\n'));
say(`restore-public.sql     ${order.filter((t) => data[t]?.length).length} tables with statements`);

// ---------------------------------------------------------------- auth users
const authUsers = (await db.query(
  `select id, email, phone, encrypted_password, email_confirmed_at, phone_confirmed_at,
          raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_super_admin,
          confirmation_token, email_change, email_change_token_new, recovery_token,
          is_sso_user, deleted_at, aud, role
     from auth.users order by created_at`,
)).rows;
const authIdentities = (await db.query(`select * from auth.identities order by created_at`)).rows;
writeFileSync(resolve(OUT, 'auth-users.json'), JSON.stringify({ generatedAt: new Date().toISOString(), users: authUsers, identities: authIdentities }, null, 2));

const authSql = [
  '-- TetherProof auth restore — THIS FILE IS A NOTE, NOT A SCRIPT.',
  '-- Generated by scripts/export-database.mjs.',
  '--',
  '-- There are deliberately no INSERT statements here.',
  '--',
  '-- An earlier version of this export emitted `INSERT INTO auth.users ...` and it does',
  '-- not work. Supabase puts a Postgres INSERT rule on auth.users that maps every column',
  '-- to DEFAULT, so any statement supplying an explicit value is refused:',
  '--',
  '--     ERROR: cannot insert a non-DEFAULT value into column "email"',
  '--',
  '-- That is a deliberate control, not a bug. It means accounts cannot be created by',
  '-- bypassing GoTrue, which keeps identity creation in one code path that evaluates',
  '-- hooks, writes auth.identities and sends confirmation mail.',
  '--',
  '-- Use this instead:',
  '--',
  '--     node scripts/restore-auth-users.mjs --dry-run   # show what would happen',
  '--     node scripts/restore-auth-users.mjs             # do it',
  '--',
  '-- It reads backups/auth-users.json and recreates each account through the',
  '-- service-role API. Read the limitations in that file before relying on it:',
  '--',
  '--   * ids are reassigned, so public.* foreign keys need rewriting or must be',
  '--     restored after, matching on email;',
  '--   * passwords cannot be carried across, because GoTrue only accepts plaintext and',
  '--     hashes it itself. The script prints the passwords it used.',
  '',
].join('\n');
writeFileSync(resolve(OUT, 'RESTORE-AUTH.md'), authSql);
say(`auth-users.json        ${authUsers.length} users, ${authIdentities.length} identities`);
say(`RESTORE-AUTH.md        explains why there is no auth SQL, and what to run instead`);

// ---------------------------------------------------------------- verification
say('-'.repeat(64));
say('VERIFICATION (re-read from the database after writing):');
let allOk = true;
for (const t of tables) {
  const live = (await db.query(`select count(*)::int n from public.${ident(t)}`)).rows[0].n;
  const exported = data[t].length;
  const ok = live === exported;
  if (!ok) allOk = false;
  say(`  ${ok ? 'ok  ' : 'FAIL'} ${t.padEnd(26)} exported ${String(exported).padStart(4)} / live ${String(live).padStart(4)}`);
}

const files = ['schema-manifest.json', 'data-public.json', 'restore-public.sql', 'auth-users.json', 'RESTORE-AUTH.md'];
say('-'.repeat(64));
say('FILES:');
for (const f of files) {
  const bytes = statSync(resolve(OUT, f)).size;
  say(`  ${f.padEnd(24)} ${String(bytes).padStart(8)} bytes  sha256:${sum(readFileSync(resolve(OUT, f))).slice(0, 16)}`);
}

writeFileSync(resolve(OUT, 'MANIFEST.txt'), log.join('\n') + '\n');
say('');
say(allOk ? `EXPORT VERIFIED: every table's exported row count matches the live database.` : `EXPORT INCOMPLETE: see FAIL lines above.`);
await db.end();
process.exit(allOk ? 0 : 1);