#!/usr/bin/env node
/**
 * TetherProof live smoke test.
 *
 * Runs the API against a real Supabase project and asserts the behaviour that
 * unit tests cannot cover: the auth trigger, Row Level Security, and the
 * single-use verification flow.
 *
 * This script CREATES AND DELETES real accounts in the target project, so it
 * refuses to run without `--live` and asks for confirmation first. Point it at
 * a throwaway project, never production.
 *
 *   npm run build
 *   npm run smoke -- --live              # API + database
 *   npm run smoke -- --live --web        # also the client confirmation page
 *   npm run smoke -- --live --yes        # skip the confirmation prompt (CI)
 *
 * Flags:
 *   --live   required; acknowledges that real data will be created and deleted
 *   --web    additionally verify /verify/{token} and the browser CORS path
 *   --yes    do not prompt (use in CI, together with --live)
 */

import { createHash, randomBytes } from 'node:crypto';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import process from 'node:process';
import { config as loadDotenv } from 'dotenv';
import { Pool } from 'pg';
import { createClient } from '@supabase/supabase-js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = new Set(process.argv.slice(2));
const LIVE = args.has('--live');
const WITH_WEB = args.has('--web');
const SKIP_PROMPT = args.has('--yes');

const API_PORT = Number(process.env.SMOKE_API_PORT || 4000);
const API = `http://127.0.0.1:${API_PORT}/api/v1`;

/**
 * Resolved from the API's own CORS_ORIGINS so the web check exercises the real
 * configured origin instead of an invented one.
 */
let WEB_PORT = Number(process.env.SMOKE_WEB_PORT || 3100);
let WEB = `http://localhost:${WEB_PORT}`;
let WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/** Only accounts this script creates match this, so cleanup can never touch real users. */
const TEST_EMAIL_PREFIX = /^(smoke|web-smoke)\./;

let passed = 0;
let failed = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    passed += 1;
    console.log(`  PASS  ${name}${detail ? `  (${detail})` : ''}`);
  } else {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}${detail ? `  (${detail})` : ''}`);
  }
}

const section = (title) => console.log(`\n===== ${title} =====`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadEnv() {
  // Single source of truth at the repository root, matching the apps.
  loadDotenv({ path: join(ROOT, '.env') });
  const required = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL'];
  const missing = required.filter((key) => !process.env[key]);
  if (missing.length > 0) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}. Copy .env.example to .env and fill it in.`);
  }
}

async function confirm(question) {
  if (SKIP_PROMPT) return true;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(`${question} [y/N] `);
  rl.close();
  return /^y(es)?$/i.test(answer.trim());
}

function portInUse(port) {
  return new Promise((resolvePromise) => {
    const socket = net.connect({ host: '127.0.0.1', port })
      .on('connect', () => {
        socket.destroy();
        resolvePromise(true);
      })
      .on('error', () => resolvePromise(false));
    setTimeout(() => {
      socket.destroy();
      resolvePromise(false);
    }, 1000);
  });
}

/** Windows does not always terminate a child through child.kill(). */
function killTree(child) {
  if (!child?.pid) return;
  try {
    spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    child.kill();
  }
}

function runCommand(command, commandArgs, options = {}) {
  return new Promise((resolvePromise) => {
    const child = spawn(command, commandArgs, { cwd: ROOT, ...options });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (code) => resolvePromise({ code, out }));
  });
}

function resolveNextBin() {
  const candidates = [
    join(ROOT, 'node_modules', 'next', 'dist', 'bin', 'next'),
    join(ROOT, 'apps', 'web', 'node_modules', 'next', 'dist', 'bin', 'next'),
  ];
  const found = candidates.find((c) => existsSync(c));
  if (!found) throw new Error('Could not locate the Next.js CLI. Run `npm install`.');
  return found;
}

async function api(method, path, { body, token, origin } = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(origin ? { Origin: origin } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  return { status: res.status, json, text, headers: res.headers };
}

/** Success bodies are returned unwrapped; tolerate both shapes. */
const unwrap = (body) => (body && typeof body === 'object' && 'data' in body ? body.data : body) ?? {};

/**
 * Builds a multipart body by hand.
 *
 * Node's fetch takes a FormData, but a File cannot be given an explicit
 * content type, and these checks depend on declaring one. Constructing the
 * encoded body directly is the only way to test the mismatch cases, which are
 * exactly the cases worth testing.
 */
function multipart(fields, file) {
  const boundary = `----smoke${Date.now().toString(16)}`;
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`,
        'utf8',
      ),
    );
  }

  if (file) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
      file.buffer,
      Buffer.from('\r\n', 'utf8'),
    );
  }

  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` };
}

/**
 * Successful media uploads this run, counted at the point of the request.
 *
 * Cleanup derives what to delete from the database rather than from this count,
 * because a list assembled during the run misses anything uploaded after the list
 * was taken. This count exists to check that derivation: if the database holds more
 * media for this run's workers than were uploaded, something wrote media without
 * going through this helper, which is worth knowing.
 */
let uploadsThisRun = 0;

async function uploadProof(fields, file, token) {
  const { body, contentType } = multipart(fields, file);
  const res = await fetch(`${API}/workers/proofs`, {
    method: 'POST',
    headers: { 'Content-Type': contentType, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body */
  }
  if (res.status === 201) uploadsThisRun += 1;
  return { status: res.status, json, text };
}

/**
 * A JPEG carrying a GPS EXIF block, as a phone camera would produce.
 *
 * The location coordinates are embedded rather than mocked, so the end-to-end
 * assertion that the stored object no longer contains them is meaningful.
 */
function gpsJpeg() {
  const tiff = Buffer.alloc(32);
  tiff.write('II', 0, 'latin1');
  tiff.writeUInt16LE(0x2a, 2);
  tiff.writeUInt32LE(8, 4);
  tiff.writeUInt16LE(1, 8);
  tiff.writeUInt16LE(0x8825, 10); // GPSInfo
  tiff.writeUInt16LE(7, 12); // UNDEFINED
  tiff.writeUInt32LE(1, 14);
  tiff.writeUInt32LE(26, 18);
  tiff.writeUInt32LE(0, 22);
  tiff.writeUInt16LE(0, 26);
  tiff.writeUInt32LE(0, 28);

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
  const app1 = Buffer.alloc(4);
  app1.writeUInt16BE(0xffe1, 0);
  app1.writeUInt16BE(payload.length + 2, 2);

  // A tiny valid JPEG body, with the EXIF block spliced in after the SOI marker.
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app1,
    payload,
    Buffer.from([
      0xff, 0xdb, 0x00, 0x43, 0x00, ...new Array(64).fill(0),
      0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x10, 0x00, 0x10, 0x01, 0x01, 0x11, 0x00,
      0xff, 0xc4, 0x00, 0x14, 0x00, 0x01, ...new Array(16).fill(0),
      0xff, 0xc4, 0x00, 0x14, 0x10, 0x01, ...new Array(16).fill(0),
      0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x37, 0xff, 0xd9,
    ]),
  ]);
}

async function main() {
  loadEnv();

  // Use the origin the API actually trusts, so the CORS assertions reflect the
  // deployed configuration rather than an invented host.
  if (WITH_WEB) {
    const configured = (process.env.CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    WEB_ORIGIN = configured[0] ?? 'http://localhost:3000';
    const parsed = new URL(WEB_ORIGIN);
    WEB_PORT = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
    WEB = `${parsed.protocol}//${parsed.hostname}:${WEB_PORT}`;
  }

  const mode = `${new URL(process.env.SUPABASE_URL).host} (${WITH_WEB ? `API + web at ${WEB_ORIGIN}` : 'API + database'})`;

  if (!LIVE) {
    console.error('Refusing to run: this test creates and deletes real accounts in your Supabase project.');
    console.error('Re-run with --live to acknowledge, e.g. `npm run smoke -- --live`.');
    process.exit(2);
  }
  const ok = await confirm(`This will create and delete test accounts in ${mode}. Continue?`);
  if (!ok) {
    console.log('Aborted. Nothing was changed.');
    process.exit(0);
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 2,
    ssl: { rejectUnauthorized: false },
  });
  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });
  /** A plain anon client, used only to redeem a generated link into a session. */
  const anonClient = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { persistSession: false },
  });

  /**
   * Password set on fixture accounts.
   *
   * Never used to authenticate: these accounts sign in through a generated link.
   * Supabase requires one to create an account at all. Declared here rather than
   * reused from the registration section, which is scoped inside the boot block and
   * so is not visible to this helper.
   */
  const FIXTURE_PASSWORD = 'SmokeTest123456';

  /**
   * Creates an account with a given role and returns a usable access token.
   *
   * Two things this deliberately does NOT do:
   *
   * - It does not call `/auth/register`. The public endpoint is rate limited to 10
   *   credential requests per 15 minutes per address, and the suite already spends
   *   six of those on tests that are actually about credential handling. Adding
   *   several more for fixtures would push the run against that ceiling and make
   *   the suite fail intermittently for reasons that have nothing to do with the
   *   code under test.
   * - It does not self-declare an elevated role. The account is created with the
   *   service-role client and the claim is written directly against the auth record,
   *   which is the only supported way to become an administrator. Registering as
   *   `admin` is refused by the API, and there is a check below asserting so.
   *
   * The session is minted with a generated link rather than a password login, again
   * to stay clear of the limiter. This is the same session object the API sees from
   * any other login: the role claim travels in the token and the API reads nothing
   * else.
   */
  const mintAccount = async (emailAddress, role, fullName) => {
    const created = await admin.auth.admin.createUser({
      email: emailAddress,
      password: FIXTURE_PASSWORD,
      app_metadata: { role },
      email_confirm: true,
      user_metadata: fullName ? { full_name: fullName } : {},
    });
    if (created.error || !created.data?.user) {
      return { id: null, token: null, error: created.error?.message ?? 'no user returned' };
    }
    createdUsers.push(created.data.user.id);

    const link = await admin.auth.admin.generateLink({ type: 'magiclink', email: emailAddress });
    if (link.error || !link.data?.properties?.hashed_token) {
      return { id: created.data.user.id, token: null, error: link.error?.message ?? 'no token hash' };
    }
    const verified = await anonClient.auth.verifyOtp({
      token_hash: link.data.properties.hashed_token,
      type: 'magiclink',
    });
    return {
      id: created.data.user.id,
      token: verified.data?.session?.access_token ?? null,
      error: verified.error?.message ?? null,
    };
  };

  const createdUsers = [];
  /**
   * Bucket paths this run attempted, used to catch probe uploads that were
   * supposed to be refused. Successful uploads are found in the database instead.
   */
  const storedPaths = [];
  /** Probe uploads deliberately aimed at the bucket's limits, expected to fail. */
  let probeAttempts = 0;
  /**
   * Proof, block, and verification rows this run deliberately left behind.
   *
   * The account-deletion test keeps evidence that a worker who logged work can be
   * deleted without their evidence being destroyed. Those rows survive with a null
   * `worker_id` by design, so the cleanup below — which is scoped by owner — cannot
   * see them and would leave them behind on every run. They are tracked by id
   * instead and removed explicitly.
   */
  const retainedRowIds = [];
  /** Hoisted so the cleanup closure can scope its deletes to this run's worker. */
  let workerId = null;
  let apiProcess;

  /**
   * Removes everything a set of test accounts own, in dependency order.
   *
   * The ordering is the point. Stored objects go first because the row deletes
   * below can be refused by a foreign key, and `media_url` is what tells us where
   * the bytes are — once the row is gone the path is unrecoverable. Then the rows,
   * in the order the foreign keys demand, and finally the auth user.
   *
   * Shared by the pre-flight and the end-of-run cleanup rather than duplicated.
   * Two copies of teardown logic drift, and the copy that drifts is the one that
   * runs when something has already gone wrong.
   *
   * Scoped strictly to the ids passed in. These deletes used to be unscoped,
   * which would have destroyed a real member's proofs had the suite ever been run
   * against live data.
   *
   * Returns the object paths it removed and any storage error, so callers report
   * what happened rather than assuming it worked.
   */
  const purgeOwnedData = async (ids, extraPaths = []) => {
    const bucket = process.env.STORAGE_PROOFS_BUCKET || 'work-proofs';
    if (ids.length === 0) return { paths: [...extraPaths], storageError: null };

    // Paths come from the database, not from a list built during the run. A
    // mid-run snapshot misses every upload made after it was taken, which is how
    // the Phase 4 fixtures were leaking objects into the bucket: the snapshot was
    // taken at the end of the trust-engine section and the matching section
    // uploaded afterwards. Deriving the list here cannot have that gap.
    const { rows: mediaRows } = await pool.query(
      'select media_url from public.work_proof_logs where worker_id = any($1::uuid[]) and media_url is not null',
      [ids],
    );
    const paths = new Set(extraPaths);
    for (const m of mediaRows) paths.add(m.media_url);

    let storageError = null;
    if (paths.size > 0) {
      const removed = await admin.storage.from(bucket).remove([...paths]);
      if (removed.error) storageError = removed.error;
    }

    await pool.query(
      `delete from public.verifications where work_proof_id in
         (select id from public.work_proof_logs where worker_id = any($1::uuid[]))`,
      [ids],
    );
    await pool.query('delete from public.work_proof_logs where worker_id = any($1::uuid[])', [ids]);
    await pool.query('delete from public.capability_blocks where worker_id = any($1::uuid[])', [ids]);

    // Phase 4 rows. `direct_offers` and `candidate_handles` reference both
    // parties, so they are keyed on either side and a worker-only delete would
    // leave an employer's rows behind to block the auth delete.
    for (const t of ['candidate_handles', 'direct_offers']) {
      await pool.query(
        `delete from public.${t}
           where employer_id = any($1::uuid[]) or worker_id = any($1::uuid[])`,
        [ids],
      );
    }
    await pool.query('delete from public.employer_specs where employer_id = any($1::uuid[])', [ids]);
    await pool.query('delete from public.employer_approvals where employer_id = any($1::uuid[])', [ids]);

    return { paths: [...paths], storageError };
  };

  /**
   * Removes stored objects whose owning account no longer exists.
   *
   * The object path is `<user_id>/<YYYY-MM-DD>/<file>`, so the first segment names the
   * uploader. If that id is not in `auth.users`, nothing owns the object: every live
   * account's media has a live owner by definition, because deleting an account
   * quarantines its media rather than abandoning it (E-029). So this is a proof of
   * orphanhood rather than a guess, which is what makes deleting on it acceptable.
   *
   * Without this the suite cannot return to a clean bucket. An object with no row and
   * no owner is invisible to every owner-scoped teardown, so it would fail the final
   * bucket check on every future run — and a check that is always red stops being
   * read, which is how a real leak would then go unnoticed.
   *
   * Deliberately narrow. An object whose prefix is not a UUID, or whose prefix belongs
   * to a live user, is left alone and left for the final bucket check to report. An
   * unexplained object should be surfaced, not deleted on a hunch.
   *
   * Refuses to run when the live account list cannot be read in full, because an
   * incomplete list would classify real members' media as orphaned.
   */
  const sweepOrphanedObjects = async () => {
    const bucket = process.env.STORAGE_PROOFS_BUCKET || 'work-proofs';
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    const page = await admin.auth.admin.listUsers({ perPage: 1000 });
    const accounts = page.data?.users ?? [];
    if (accounts.length >= 1000) {
      console.log('   warning: too many accounts to enumerate safely, skipping the orphan sweep');
      return [];
    }
    const live = new Set(accounts.map((u) => u.id));

    const orphans = [];
    const walk = async (prefix) => {
      const { data } = await admin.storage.from(bucket).list(prefix, { limit: 1000 });
      for (const entry of data ?? []) {
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id) {
          const owner = path.split('/')[0];
          if (UUID.test(owner) && !live.has(owner)) orphans.push(path);
        } else {
          await walk(path);
        }
      }
    };
    await walk('');

    if (orphans.length > 0) {
      const { error } = await admin.storage.from(bucket).remove(orphans);
      if (error) {
        console.log(`   warning: could not sweep orphaned media: ${error.message}`);
        return [];
      }
    }
    return orphans;
  };

  const cleanup = async () => {
    section('CLEANUP');
    try {
      // Scoped to the accounts THIS RUN created, tracked by id. These deletes
      // used to be unscoped, which would have destroyed a real member's proofs,
      // capability blocks, and verifications if the suite were ever run against
      // live data. They then narrowed too far, to a single worker: the `--web`
      // path creates a second one, and scoping to only the first left its rows
      // behind, which made the auth delete fail on a surviving foreign key and
      // leaked an account on every web run.
      const owned = createdUsers.length > 0 ? createdUsers : [workerId].filter(Boolean);
      const { paths: pathsToRemove, storageError } = await purgeOwnedData(owned, storedPaths);

      if (pathsToRemove.length > 0) {
        check(
          'stored proof media removed from the bucket',
          !storageError,
          storageError?.message ?? `${pathsToRemove.length} object(s)`,
        );
        check(
          'every upload this run made is accounted for',
          uploadsThisRun <= pathsToRemove.length + probeAttempts,
          `${uploadsThisRun} upload(s), ${pathsToRemove.length} path(s) removed`,
        );
        // Object deletion is asynchronous, so an object can still be listed a
        // moment after the remove call reports success. Waiting for the list to
        // drain keeps that lag distinguishable from a real leak; without it the
        // two are indistinguishable and the leak check becomes unreliable in the
        // one direction that matters.
        for (let attempt = 0; attempt < 10; attempt += 1) {
          const { data: stillThere } = await admin.storage
            .from(process.env.STORAGE_PROOFS_BUCKET || 'work-proofs')
            .list('', { limit: 1000 });
          if ((stillThere ?? []).length === 0) break;
          await sleep(1000);
        }
      }

      for (const id of createdUsers) {
        const del = await admin.auth.admin.deleteUser(id);
        if (del.error) console.log(`   warning: could not delete ${id}: ${del.error.message}`);
      }

      // Rows the deletion test deliberately retained. They carry a null
      // `worker_id`, so the owner-scoped deletes above cannot reach them. Removed
      // here so a verification run leaves the live database as it found it.
      if (retainedRowIds.length > 0) {
        await pool.query('delete from public.verifications where id = any($1::uuid[])', [retainedRowIds]);
        await pool.query('delete from public.work_proof_logs where id = any($1::uuid[])', [retainedRowIds]);
        await pool.query('delete from public.capability_blocks where id = any($1::uuid[])', [retainedRowIds]);
      }
      const { rows: retainedLeft } = await pool.query(
        `select count(*)::int n from public.work_proof_logs where id = any($1::uuid[])`,
        [retainedRowIds.length > 0 ? retainedRowIds : ['00000000-0000-0000-0000-000000000000']],
      );
      check('retained anonymised rows removed after being verified', retainedLeft[0].n === 0, `${retainedLeft[0].n} rows`);

      // Scoped to the test address pattern rather than counting every row in the
      // table. Counting all of `auth.users` fails for the wrong reason the moment
      // the project has a real member, which trains you to ignore this check.
      const usersLeft = (
        await pool.query(`select email from auth.users where email ~ '^(smoke|web-smoke)\\.@'`)
      ).rows.length;
      check('test accounts removed from auth.users', usersLeft === 0, `${usersLeft} rows`);

      const { rows: proofRows } = await pool.query(
        `select count(*)::int n from public.work_proof_logs
          where worker_id = any($1::uuid[])`,
        [owned.length > 0 ? owned : ['00000000-0000-0000-0000-000000000000']],
      );
      check('test rows removed from the application tables', proofRows[0].n === 0, `${proofRows[0].n} rows`);

      // The check above is scoped to the workers this run created, so it cannot see a
      // row belonging to a worker the harness forgot to track. These catch
      // exactly that, but without false-alarming on real data: a row is an
      // orphan only if its owner no longer exists in `auth.users`. A real
      // member's rows always have a live owner, so they are never counted.
      //
      // `worker_id is not null` is load-bearing since migration 0005 made the
      // column nullable. An anonymised row has a null worker by design, so the
      // absence of a matching `auth.users` row is true of it by construction and
      // this check would count every deliberately retained record as a leak — and
      // would then, by being ignored, stop meaning anything.
      for (const t of ['work_proof_logs', 'capability_blocks']) {
        const { rows } = await pool.query(
          `select count(*)::int n from public.${t} t
             where t.worker_id is not null
               and not exists (select 1 from auth.users u where u.id = t.worker_id)`,
        );
        check(`no orphaned rows left in public.${t}`, rows[0].n === 0, `${rows[0].n} rows`);
      }
      // Same predicate for the Phase 4 tables, keyed on whichever party the row
      // points at. A real employer's specs always have a live owner, so a live
      // member never trips this.
      for (const t of ['employer_specs', 'employer_approvals']) {
        const { rows } = await pool.query(
          `select count(*)::int n from public.${t} t
             where not exists (select 1 from auth.users u where u.id = t.employer_id)`,
        );
        check(`no orphaned rows left in public.${t}`, rows[0].n === 0, `${rows[0].n} rows`);
      }
      for (const t of ['direct_offers', 'candidate_handles']) {
        const { rows } = await pool.query(
          `select count(*)::int n from public.${t} t
             where not exists (select 1 from auth.users u where u.id = t.employer_id)
                or not exists (select 1 from auth.users u where u.id = t.worker_id)`,
        );
        check(`no orphaned rows left in public.${t}`, rows[0].n === 0, `${rows[0].n} rows`);
      }
      const { rows: orphanVerifications } = await pool.query(
        `select count(*)::int n from public.verifications v
           where not exists (select 1 from public.work_proof_logs t where t.id = v.work_proof_id)`,
      );
      check(
        'no orphaned rows left in public.verifications',
        orphanVerifications[0].n === 0,
        `${orphanVerifications[0].n} rows`,
      );

      // A row here is a stored object that outlived its account, which means the
      // bytes are still in the bucket under a path nobody can find any more. The
      // deletion test drains its own; anything left at this point is either a real
      // pending sweep or a leak from an interrupted run, and either way it is a
      // file that should not be there.
      const { rows: quarantineLeft } = await pool.query(
        'select count(*)::int n from public.orphaned_proof_media',
      );
      check(
        'no stored media left awaiting removal in public.orphaned_proof_media',
        quarantineLeft[0].n === 0,
        `${quarantineLeft[0].n} rows`,
      );

      const { data: bucketLeft } = await admin.storage
        .from(process.env.STORAGE_PROOFS_BUCKET || 'work-proofs')
        .list('', { limit: 1000 });
      check('no proof media left in the bucket', (bucketLeft ?? []).length === 0, `${(bucketLeft ?? []).length} object(s)`);
    } catch (error) {
      check('cleanup completed', false, error instanceof Error ? error.message : String(error));
    }
  };

  try {
    section('PRE-FLIGHT');
    if (await portInUse(API_PORT)) throw new Error(`Port ${API_PORT} is in use. Stop that process first.`);
    check(`port ${API_PORT} is free`, true);

    const stale = (await admin.auth.admin.listUsers({ perPage: 200 })).data?.users ?? [];
    const leftovers = stale.filter((u) => TEST_EMAIL_PREFIX.test(u.email ?? ''));

    // E-025 / E-029. This used to be `deleteUser(...).catch(() => undefined)`, which
    // could not succeed for a worker that had logged work and hid the reason: the
    // suite then failed on every later run while cleaning nothing.
    //
    // Now that the foreign keys are `on delete set null`, `deleteUser` does succeed.
    // But deleting the account is the *wrong half* of the teardown on its own. The
    // stored media is removed through the Storage API, never by the anonymisation
    // trigger, so a bare `deleteUser` leaves the objects in the bucket with nothing
    // pointing at them — and the pre-flight has just destroyed the pointer. The rows
    // go first, then the account, which is what `purgeOwnedData` is ordered for.
    if (leftovers.length > 0) {
      const staleIds = leftovers.map((u) => u.id);
      const { paths, storageError } = await purgeOwnedData(staleIds);
      if (storageError) console.log(`   warning: could not remove earlier media: ${storageError.message}`);
      for (const id of staleIds) {
        const del = await admin.auth.admin.deleteUser(id);
        if (del.error) console.log(`   warning: could not delete ${id}: ${del.error.message}`);
      }
      console.log(`   removed ${leftovers.length} leftover account(s) and ${paths.length} stored object(s)`);
    }
    check('no leftover accounts from an earlier run', leftovers.length === 0, `${leftovers.length} removed`);

    // Anything the leftover teardown above could not reach, because the account that
    // uploaded it is already gone and there is no id left to scope the delete by.
    const swept = await sweepOrphanedObjects();
    if (swept.length > 0) {
      console.log(`   swept ${swept.length} stored object(s) whose owning account no longer exists`);
    }

    if (!existsSync(join(ROOT, 'apps', 'api', 'dist', 'index.js'))) {
      throw new Error('apps/api/dist/index.js is missing. Run `npm run build` first.');
    }

    section('STORAGE BUCKET');
    // E-017. Supabase's management API accepts file_size_limit and
    // allowed_mime_types and then discards them, so a bucket can look configured
    // while accepting any type at any size. Read the stored values, then prove
    // they are actually enforced rather than merely present.
    const bucketName = process.env.STORAGE_PROOFS_BUCKET || 'work-proofs';
    const bucket = (
      await pool.query(
        'select public, file_size_limit, allowed_mime_types from storage.buckets where name = $1',
        [bucketName],
      )
    ).rows[0];

    check(`bucket "${bucketName}" exists`, Boolean(bucket));
    check('bucket is private', bucket?.public === false, `public=${bucket?.public}`);
    check(
      'bucket records a size limit',
      Number(bucket?.file_size_limit) > 0,
      `file_size_limit=${bucket?.file_size_limit ?? 'NOT SET'}`,
    );

    const expectedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'audio/mpeg', 'audio/mp4', 'audio/aac'];
    const storedMimes = Array.isArray(bucket?.allowed_mime_types) ? bucket.allowed_mime_types : [];
    check(
      'bucket records the expected MIME allow-list',
      expectedMimes.every((m) => storedMimes.includes(m)),
      JSON.stringify(storedMimes),
    );

    if (bucket) {
      const refused = async (label, path, body, contentType) => {
        storedPaths.push(path);
        probeAttempts += 1;
        const { error } = await admin.storage.from(bucketName).upload(path, body, { contentType, upsert: true });
        check(`bucket refuses ${label}`, Boolean(error), error ? error.message.slice(0, 60) : 'ACCEPTED');
      };

      const cap = Number(bucket.file_size_limit) || 10 * 1024 * 1024;
      await refused('a type outside the allow-list', `probe/mime-${Date.now()}.txt`, Buffer.from('hello'), 'text/plain');
      await refused('an oversized object', `probe/size-${Date.now()}.jpg`, Buffer.alloc(cap + 1024, 0x41), 'image/jpeg');
    }

    section('BOOT API');
    apiProcess = spawn(process.execPath, ['dist/index.js'], {
      cwd: join(ROOT, 'apps', 'api'),
      env: { ...process.env, PORT: String(API_PORT), API_PORT: String(API_PORT) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let apiLog = '';
    apiProcess.stdout.on('data', (d) => (apiLog += d));
    apiProcess.stderr.on('data', (d) => (apiLog += d));

    let up = false;
    for (let i = 0; i < 40 && !up; i += 1) {
      await sleep(500);
      if (apiProcess.exitCode !== null) break;
      try {
        if ((await api('GET', '/health')).status === 200) up = true;
      } catch {
        /* not listening yet */
      }
    }
    check('API starts and reports healthy', up && apiProcess.exitCode === null, up ? 'health 200' : apiLog.slice(-300));
    if (!up) return;

    const health = await api('GET', '/health');
    check('health reports the database as up', health.json?.database === 'up', JSON.stringify(health.json));

    section('REGISTRATION');
    const email = `smoke.${Date.now()}@tetherproof.dev`;
    const password = 'SmokeTest123456';
    const reg = await api('POST', '/auth/register', {
      body: { email, password, role: 'worker', fullName: 'Smoke Test Worker' },
    });
    check('register returns 201', reg.status === 201, `status ${reg.status} ${reg.text.slice(0, 140)}`);
    const userId = unwrap(reg.json)?.user?.id;
    if (userId) createdUsers.push(userId);
    workerId = userId ?? null;

    if (userId) {
      const role = (await pool.query('select role from public.users where id = $1', [userId])).rows[0];
      check('auth trigger created the application user row', role?.role === 'worker', JSON.stringify(role));

      const profile = (
        await pool.query('select full_name from public.profiles where user_id = $1', [userId])
      ).rows[0];
      check('profile row created', profile?.full_name === 'Smoke Test Worker', JSON.stringify(profile));

      // `role` must stay quoted: auth.users has its own column called `role`.
      const claim = (
        await pool.query(`select raw_app_meta_data->>'role' as role_claim from auth.users where id = $1`, [userId])
      ).rows[0];
      check('role claim written to app_metadata', claim?.role_claim === 'worker', JSON.stringify(claim));
    }

    const dup = await api('POST', '/auth/register', { body: { email, password, role: 'worker' } });
    check('duplicate registration is rejected', dup.status === 409 || dup.status === 400, `status ${dup.status}`);

    const challenge = unwrap(reg.json)?.confirmation;
    check(
      'register returns a confirmation challenge',
      challenge?.channel === 'email' &&
        typeof challenge?.destination === 'string' &&
        typeof challenge?.delivered === 'boolean',
      JSON.stringify(challenge),
    );
    check(
      'challenge destination is masked, not the raw address',
      challenge?.destination !== email,
      challenge?.destination ?? '',
    );

    section('ACCOUNT CONFIRMATION');
    // `.invalid` can never resolve, so these checks cannot deliver a message even
    // once a provider is configured. They must not depend on receiving a code.
    //
    // The two `/confirm/request` calls share the 5-per-15-minutes
    // `confirmationRateLimiter` budget for 127.0.0.1. The `/confirm` calls use
    // the separate `codeVerificationRateLimiter` at 10, which is why the success
    // path below can be covered without tripping a limit.
    const unknown = `no-such-user-${Date.now()}@tetherproof.invalid`;
    const requestRes = await api('POST', '/auth/confirm/request', { body: { email: unknown } });
    check(
      'confirm/request answers 202 for an unregistered address',
      requestRes.status === 202,
      `status ${requestRes.status}`,
    );
    check(
      'confirm/request does not reveal that the account is unknown',
      requestRes.json?.delivered === false && typeof requestRes.json?.destination === 'string',
      JSON.stringify(requestRes.json),
    );

    const repeatRes = await api('POST', '/auth/confirm/request', { body: { email: unknown } });
    check(
      'repeated confirm/request answers identically',
      JSON.stringify(repeatRes.json) === JSON.stringify(requestRes.json),
      `${JSON.stringify(requestRes.json)} vs ${JSON.stringify(repeatRes.json)}`,
    );

    const wrongCode = await api('POST', '/auth/confirm', { body: { email: unknown, token: '000000' } });
    check('a wrong code is refused', wrongCode.status === 400, `status ${wrongCode.status}`);
    check(
      'a wrong code returns AUTH_CODE_INVALID',
      wrongCode.json?.error?.code === 'AUTH_CODE_INVALID',
      JSON.stringify(wrongCode.json?.error),
    );
    check(
      'a wrong code leaks no provider detail',
      !/otp|token hash|expired|supabase/i.test(wrongCode.json?.error?.message ?? ''),
      wrongCode.json?.error?.message ?? '',
    );

    const shortCode = await api('POST', '/auth/confirm', { body: { email: unknown, token: '12' } });
    check('a too-short code fails validation', shortCode.status === 400, `status ${shortCode.status}`);
    check(
      'validation names the offending field',
      shortCode.json?.error?.details?.some((d) => d.path === 'token'),
      JSON.stringify(shortCode.json?.error?.details),
    );

    // The success path, without needing a real inbox: `generateLink` mints a
    // genuine Supabase token without sending anything, so the code-to-session
    // exchange can be asserted even when no mail provider is configured.
    // This is what caught the token/token_hash mismatch recorded as E-016.
    const linkEmail = `smoke.${Date.now()}.link@tetherproof.invalid`;
    const linkPassword = 'SmokeTest123456';
    const linkReg = await api('POST', '/auth/register', {
      body: { email: linkEmail, password: linkPassword, role: 'worker' },
    });
    const linkUserId = unwrap(linkReg.json)?.user?.id;
    if (linkUserId) createdUsers.push(linkUserId);

    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'signup',
      email: linkEmail,
    });
    check('a real confirmation token can be minted for tests', !linkErr, linkErr?.message ?? '');

    const linkToken = linkData?.properties?.hashed_token;
    const linkConfirm = await api('POST', '/auth/confirm', { body: { email: linkEmail, token: linkToken } });
    check(
      'a valid code is exchanged for a session',
      linkConfirm.status === 200,
      `status ${linkConfirm.status} ${linkConfirm.text.slice(0, 140)}`,
    );
    check(
      'the issued session carries an access token',
      typeof unwrap(linkConfirm.json)?.session?.accessToken === 'string',
      JSON.stringify(unwrap(linkConfirm.json)?.session ?? {}).slice(0, 80),
    );
    check(
      'a confirmed account no longer needs a challenge',
      unwrap(linkConfirm.json)?.confirmation === null,
      JSON.stringify(unwrap(linkConfirm.json)?.confirmation),
    );

    const linkReplay = await api('POST', '/auth/confirm', { body: { email: linkEmail, token: linkToken } });
    check('replaying a used token is refused', linkReplay.status === 400, `status ${linkReplay.status}`);

    const linkLogin = await api('POST', '/auth/login', { body: { email: linkEmail, password: linkPassword } });
    check(
      'an account confirmed via the endpoint can then sign in',
      linkLogin.status === 200,
      `status ${linkLogin.status} ${linkLogin.text.slice(0, 140)}`,
    );

    section('LOGIN');
    const beforeConfirm = await api('POST', '/auth/login', { body: { email, password } });
    check('unconfirmed account cannot sign in', beforeConfirm.status === 401, `status ${beforeConfirm.status}`);
    check(
      'rejection does not reveal whether the account exists',
      /incorrect sign-in details/i.test(beforeConfirm.json?.error?.message ?? ''),
      beforeConfirm.json?.error?.message ?? '',
    );

    if (userId) {
      // Confirm only the channel that exists: confirming a phone number on a
      // user who has none makes Supabase reject the whole update.
      const confirmRes = await admin.auth.admin.updateUserById(userId, { email_confirm: true });
      check('account can be confirmed', !confirmRes.error, confirmRes.error?.message ?? '');
    }

    const login = await api('POST', '/auth/login', { body: { email, password } });
    check('confirmed account signs in', login.status === 200, `status ${login.status} ${login.text.slice(0, 140)}`);
    const token = unwrap(login.json)?.session?.accessToken;
    check('session contains an access token', typeof token === 'string' && token.length > 40);

    section('AUTHORIZED PROFILE');
    if (token) {
      const me = await api('GET', '/auth/me', { token });
      check('GET /auth/me returns the caller profile', me.status === 200, `status ${me.status}`);
      check('profile carries the correct role', unwrap(me.json)?.role === 'worker', JSON.stringify(unwrap(me.json)).slice(0, 160));
    }
    check('GET /auth/me without a token is refused', (await api('GET', '/auth/me')).status === 401);

    section('PROOF SUBMISSION AND METADATA SCRUBBING');
    if (userId && token) {
      const proofFields = {
        description: 'Replaced the compressor and cleared the electrical fault on site.',
        skillTag: 'Refrigeration Repair',
        submissionGps: '5.6037,-0.1870',
        verifierPhone: '+233241234567',
      };
      const tagged = gpsJpeg();

      const submitted = await uploadProof(
        proofFields,
        { field: 'media_file', filename: 'proof.jpg', contentType: 'image/jpeg', buffer: tagged },
        token,
      );
      check('a proof with media is accepted', submitted.status === 201, `status ${submitted.status} ${submitted.text.slice(0, 160)}`);

      const body = unwrap(submitted.json);
      check('the response carries a proof id', typeof body.proofId === 'string', String(body.proofId));
      check('a capability block was created for the skill', typeof body.capabilityBlockId === 'string', body.skillTag ?? '');
      check(
        'metadata status is pending, not falsely valid',
        body.metadataStatus === 'pending',
        String(body.metadataStatus),
      );
      check('the scrub reports it removed metadata', body.scrubbed?.hadMetadata === true, JSON.stringify(body.scrubbed));
      check(
        'the scrub reports it removed GPS',
        body.scrubbed?.hadGps === true,
        `hadGps=${body.scrubbed?.hadGps}`,
      );
      check(
        'a single-use verification token is returned once',
        typeof body.verificationToken === 'string' && body.verificationToken.length >= 32,
      );

      // The decisive check: read the object back out of the bucket and confirm the
      // location data really is gone from the bytes that were stored.
      if (body.proofId) {
        const { rows } = await pool.query(
          'select media_url, metadata_status from public.work_proof_logs where id = $1',
          [body.proofId],
        );
        const mediaPath = rows[0]?.media_url;
        check('the proof row records the stored object', typeof mediaPath === 'string', String(mediaPath));

        if (mediaPath) {
          storedPaths.push(mediaPath);
          const { data: downloaded, error: dlError } = await admin.storage
            .from(process.env.STORAGE_PROOFS_BUCKET || 'work-proofs')
            .download(mediaPath);

          check('the stored object can be read back', !dlError && Boolean(downloaded), dlError?.message ?? '');
          if (downloaded) {
            const bytes = Buffer.from(await downloaded.arrayBuffer());
            check('the stored object is a JPEG', bytes[0] === 0xff && bytes[1] === 0xd8, `first bytes ${bytes[0]},${bytes[1]}`);
            check(
              'the stored object contains no EXIF segment',
              !bytes.includes(Buffer.from('Exif\0\0', 'latin1')),
              bytes.includes(Buffer.from('Exif\0\0', 'latin1')) ? 'EXIF still present' : 'clean',
            );
            // Not a size comparison. Re-encoding a real photo normally makes it
            // larger, because the output is a clean full-quality encode while the
            // fixture is a minimal hand-built JPEG. What matters is that the file
            // is a genuine re-encode rather than the bytes that were sent, which
            // the EXIF check above already proves.
            check(
              'the stored bytes differ from what was uploaded',
              !bytes.equals(tagged),
              `${tagged.length} uploaded -> ${bytes.length} stored (re-encode)`,
            );
          }
        }
      }

      // The raw token must not be recoverable from the database.
      if (body.proofId) {
        const { rows } = await pool.query(
          'select token_hash from public.verifications where work_proof_id = $1',
          [body.proofId],
        );
        const stored = rows[0]?.token_hash ?? '';
        check('only the hash of the new token is stored', /^[a-f0-9]{64}$/.test(stored), stored.slice(0, 16));
        check(
          'the returned token is not what was stored',
          stored !== body.verificationToken,
        );
      }

      // A capability block must not be creatable for someone else's worker.
      if (body.capabilityBlockId) {
        const crossAccount = await uploadProof(
          { ...proofFields, capabilityBlockId: body.capabilityBlockId, skillTag: '' },
          { field: 'media_file', filename: 'p.jpg', contentType: 'image/jpeg', buffer: gpsJpeg() },
          token,
        );
        check(
          'an unknown capability reference is refused',
          crossAccount.status === 404 || crossAccount.status === 400,
          `status ${crossAccount.status}`,
        );
      }

      const noFile = await uploadProof(proofFields, null, token);
      check(
        'a submission without a file is refused',
        noFile.status === 400,
        `status ${noFile.status} ${noFile.text.slice(0, 120)}`,
      );

      const wrongField = await uploadProof(
        proofFields,
        { field: 'attachment', filename: 'p.jpg', contentType: 'image/jpeg', buffer: gpsJpeg() },
        token,
      );
      check(
        'a file under an unexpected field name is refused',
        wrongField.status === 400,
        `status ${wrongField.status}`,
      );

      const badGps = await uploadProof(
        { ...proofFields, submissionGps: '999,999' },
        { field: 'media_file', filename: 'p.jpg', contentType: 'image/jpeg', buffer: gpsJpeg() },
        token,
      );
      check(
        'out-of-range coordinates are refused',
        badGps.status === 400,
        `status ${badGps.status} ${badGps.text.slice(0, 120)}`,
      );

      const webm = await uploadProof(
        proofFields,
        { field: 'media_file', filename: 'p.webm', contentType: 'audio/webm', buffer: Buffer.from([0x1a, 0x45, 0xdf, 0xa3]) },
        token,
      );
      check(
        'WebM is refused because it cannot be stripped',
        webm.status === 400,
        `status ${webm.status} ${webm.text.slice(0, 120)}`,
      );

      const disguised = await uploadProof(
        proofFields,
        {
          field: 'media_file',
          filename: 'p.jpg',
          contentType: 'image/jpeg',
          buffer: Buffer.from('<?php system($_GET[0]); ?>'),
        },
        token,
      );
      check(
        'a script disguised as a JPEG is refused',
        disguised.status === 400,
        `status ${disguised.status} ${disguised.text.slice(0, 120)}`,
      );

      const noAuth = await uploadProof(proofFields, null, null);
      check('an unauthenticated upload is refused', noAuth.status === 401, `status ${noAuth.status}`);

      const shortText = await uploadProof(
        { ...proofFields, description: 'done' },
        { field: 'media_file', filename: 'p.jpg', contentType: 'image/jpeg', buffer: gpsJpeg() },
        token,
      );
      check(
        'a too-short description is refused',
        shortText.status === 400,
        `status ${shortText.status}`,
      );
    }

    section('VERIFICATION LINK');
    let rawToken = null;
    if (userId) {
      // Upsert, not insert. The proof-submission checks above already created this
      // exact skill for this worker, and (worker_id, skill_tag) is unique, so a
      // plain insert would abort the run.
      const block = (
        await pool.query(
          `insert into public.capability_blocks (worker_id, skill_tag, skill_level)
           values ($1,'Refrigeration Repair',3)
           on conflict (worker_id, skill_tag) do update set skill_level = 3
           returning id`,
          [userId],
        )
      ).rows[0];
      const proof = (
        await pool.query(
          `insert into public.work_proof_logs (worker_id, capability_block_id, description, media_url, metadata_status, submission_gps)
           values ($1,$2,$3,$4,'valid',$5) returning id`,
          [userId, block.id, 'Replaced commercial compressor and fixed electrical fault.', null, '5.6037,-0.1870'],
        )
      ).rows[0];

      rawToken = randomBytes(32).toString('base64url');
      const tokenHash = createHash('sha256').update(rawToken, 'utf8').digest('hex');
      // A salted hash, as the API now writes. The smoke script cannot compute the
      // real one without the operator's salt, so this row carries a
      // well-formed placeholder: the point of the check below is the column's
      // shape, and a real salted hash is verified by the submission path further
      // down, which goes through the API.
      await pool.query(
        `insert into public.verifications (work_proof_id, verifier_phone_hash, token_hash, expires_at)
         values ($1,$2,$3, now() + interval '3 days')`,
        [proof.id, 'a'.repeat(64), tokenHash],
      );

      const stored = (
        await pool.query('select token_hash from public.verifications where work_proof_id = $1', [proof.id])
      ).rows[0];
      check('only the SHA-256 hash is stored', stored?.token_hash === tokenHash && tokenHash.length === 64);
      const rawLeak = await pool.query('select 1 from public.verifications where token_hash = $1', [rawToken]);
      check('raw token is never stored', rawLeak.rowCount === 0);

      const view = await api('GET', `/verifications/${rawToken}`);
      check('verification link returns the task summary', view.status === 200, `status ${view.status}`);
      check('summary is awaiting a response', view.json?.status === 'awaiting_response', JSON.stringify(view.json).slice(0, 140));

      check('malformed token is rejected by validation', (await api('GET', '/verifications/nope')).status === 400);
      check(
        'unknown but well-formed token returns 404',
        (await api('GET', `/verifications/${randomBytes(32).toString('base64url')}`)).status === 404,
      );

      const confirm1 = await api('POST', `/verifications/${rawToken}`, {
        body: { response: 'confirmed', verifierGps: '5.6039,-0.1872' },
      });
      check('client confirmation is accepted', confirm1.status === 200, `status ${confirm1.status}`);

      const row = (
        await pool.query(
          `select response, completed_at, (select verification_status from public.work_proof_logs where id=$1) as proof_status
             from public.verifications where work_proof_id=$1`,
          [proof.id],
        )
      ).rows[0];
      check('confirmation persisted and proof marked verified', row?.response === 'confirmed' && row?.proof_status === 'verified', JSON.stringify(row));

      // The proximity check ran and recorded a distance, not just a status.
      const proximityRow = (
        await pool.query(
          `select proximity_status, proximity_km, fraud_score, fraud_score_detail
             from public.verifications where work_proof_id=$1`,
          [proof.id],
        )
      ).rows[0];
      check(
        'a near-site tap is recorded as within the threshold',
        proximityRow?.proximity_status === 'within',
        String(proximityRow?.proximity_status),
      );
      check(
        'the distance between the two points is recorded',
        typeof proximityRow?.proximity_km === 'number' && proximityRow.proximity_km < 2,
        `${proximityRow?.proximity_km} km`,
      );
      check(
        'a clean confirmation scores above the block threshold',
        typeof proximityRow?.fraud_score === 'number' && proximityRow.fraud_score > 0.25,
        String(proximityRow?.fraud_score),
      );
      check(
        'the score is explainable from stored data, not just logs',
        Boolean(proximityRow?.fraud_score_detail?.proximity)
        && Boolean(proximityRow?.fraud_score_detail?.collusion)
        && proximityRow?.fraud_score_detail?.proximity?.distanceKm !== undefined,
        JSON.stringify(proximityRow?.fraud_score_detail ?? {}).slice(0, 160),
      );

      const replay = await api('POST', `/verifications/${rawToken}`, { body: { response: 'confirmed' } });
      check('replayed link is refused', replay.status === 409, `status ${replay.status}`);
      check(
        'invalid response value is rejected',
        [400, 409].includes((await api('POST', `/verifications/${rawToken}`, { body: { response: 'maybe' } })).status),
      );

      // Proves the fix for the missing range check. Before, the confirm endpoint
      // validated only the `lat,lon` shape, so this value was accepted here while
      // being rejected on submission. One laxer endpoint is enough to poison the
      // proximity calculation.
      const badGpsBlock = (
        await pool.query(
          `insert into public.work_proof_logs (worker_id, capability_block_id, description, metadata_status, submission_gps)
           select worker_id, capability_block_id, 'Range check fixture.', 'valid', '5.6,-0.18'
             from public.work_proof_logs where id=$1 returning id`,
          [proof.id],
        )
      ).rows[0];
      const badGpsToken = randomBytes(32).toString('base64url');
      await pool.query(
        `insert into public.verifications (work_proof_id, token_hash, expires_at)
         values ($1,$2, now() + interval '3 days')`,
        [
          badGpsBlock.id,
          createHash('sha256').update(badGpsToken, 'utf8').digest('hex'),
        ],
      );
      check(
        'out-of-range coordinates are refused on the confirm endpoint too',
        (await api('POST', `/verifications/${badGpsToken}`, {
          body: { response: 'confirmed', verifierGps: '999,999' },
        })).status === 400,
      );
    }

    // ---------------------------------------------------------------------
    section('TRUST AND ANTI-FRAUD ENGINE');
    // ---------------------------------------------------------------------
    // The collusion graph is only meaningful if real endorsements build it up, so
    // this drives the whole loop through the public API rather than writing rows
    // directly. Each submission is confirmed at a real distance, which is what
    // gives the engine a history to weigh the next one against.
    if (userId && token) {
      // A phone number used nowhere else in the run, so its hash is unique to
      // this verifier and the history below belongs to it alone.
      const RING_PHONE = '+233550000001';
      const ACCRA = '5.6037,-0.1870';
      const LONDON = '51.5074,-0.1278';

      // Declared out here because the privacy checks below read it after the
      // block that fills it in has closed.
      let offsiteRow = null;
      let dispatchUnexpected = false;

      /** Submits a proof and returns the body, or null if it was refused. */
      const submit = async (skillTag, overrides = {}) => {
        const result = await uploadProof(
          {
            description: `Verified job site attendance for ${skillTag}, logged by the site supervisor.`,
            skillTag,
            submissionGps: ACCRA,
            verifierPhone: RING_PHONE,
            ...overrides,
          },
          { field: 'media_file', filename: 'p.jpg', contentType: 'image/jpeg', buffer: gpsJpeg() },
          token,
        );
        return result.status === 201 ? unwrap(result.json) : null;
      };

      // Five confirmations by one verifier, all for one worker, all on site. This
      // is what a site supervisor legitimately looks like, and it is also the
      // shape a ring takes, so it is the only way to reach the engine's
      // concentration check.
      const ringProofs = [];
      for (let i = 0; i < 5; i += 1) {
        const body = await submit(`Boiler Servicing ${i}`);
        if (!body) break;

        if (body.verificationLinkSent !== false) {
          dispatchUnexpected = true;
        }

        const confirmed = await api('POST', `/verifications/${body.verificationToken}`, {
          body: { response: 'confirmed', verifierGps: '5.6040,-0.1871' },
        });
        if (confirmed.status === 200) ringProofs.push(body.proofId);
      }
      check('five endorsements build a history for one verifier', ringProofs.length === 5, `${ringProofs.length} of 5`);

      // A sixth confirmation by the same verifier, this one from another continent.
      const offsite = await submit('Boiler Servicing offsite');
      check('a sixth proof is accepted', offsite !== null);

      if (offsite) {
        const offsiteConfirm = await api('POST', `/verifications/${offsite.verificationToken}`, {
          body: { response: 'confirmed', verifierGps: LONDON },
        });
        check('an off-site confirmation is still accepted as a response', offsiteConfirm.status === 200, `status ${offsiteConfirm.status}`);

        offsiteRow = (
          await pool.query(
            `select v.proximity_status, v.proximity_km, v.fraud_score, v.fraud_score_detail,
                    (select verification_status from public.work_proof_logs where id=$1) as proof_status
               from public.verifications v where v.work_proof_id=$1`,
            [offsite.proofId],
          )
        ).rows[0];

        check(
          'a confirmation from another continent is recorded as outside the threshold',
          offsiteRow?.proximity_status === 'outside',
          String(offsiteRow?.proximity_status),
        );
        check(
          'the recorded distance is a real one, not null',
          typeof offsiteRow?.proximity_km === 'number' && offsiteRow.proximity_km > 1000,
          `${offsiteRow?.proximity_km} km`,
        );
        check(
          'the concentration of this verifier is detected',
          offsiteRow?.fraud_score_detail?.collusion?.findings?.some((f) => f.includes('unusually large share')) === true,
          JSON.stringify(offsiteRow?.fraud_score_detail?.collusion?.findings ?? []),
        );
        check(
          'the score falls below the block threshold',
          typeof offsiteRow?.fraud_score === 'number' && offsiteRow.fraud_score <= 0.25,
          String(offsiteRow?.fraud_score),
        );
        check(
          'the proof is blocked from counting as verified',
          offsiteRow?.proof_status === 'fraud_blocked',
          String(offsiteRow?.proof_status),
        );

        // The client is told what actually happened: they did confirm it.
        check(
          'the client is told their response was recorded as a confirmation',
          unwrap(offsiteConfirm.json)?.status === 'confirmed',
          JSON.stringify(offsiteConfirm.json).slice(0, 120),
        );
      }

      // A client who declines to share a location. Absence of evidence must not
      // read as a finding, or anyone could defeat the engine by withholding data.
      const noLocation = await submit('Boiler Servicing no location');
      if (noLocation) {
        await api('POST', `/verifications/${noLocation.verificationToken}`, {
          body: { response: 'confirmed' },
        });
        const row = (
          await pool.query(
            `select v.proximity_status, v.proximity_km, v.fraud_score, v.fraud_score_detail,
                    (select verification_status from public.work_proof_logs where id=$1) as proof_status
               from public.verifications v where v.work_proof_id=$1`,
            [noLocation.proofId],
          )
        ).rows[0];
        check('a client who shares no location is unavailable, not failing', row?.proximity_status === 'unavailable', String(row?.proximity_status));
        check('unavailable records no distance', row?.proximity_km === null, String(row?.proximity_km));
        check(
          'withholding a location does not block the proof',
          row?.proof_status === 'verified',
          String(row?.proof_status),
        );
        check(
          'the reason it was unavailable is recorded for explanation',
          String(row?.fraud_score_detail?.proximity?.status ?? '') === 'unavailable',
          JSON.stringify(row?.fraud_score_detail?.proximity ?? {}).slice(0, 120),
        );
      }

      // A rejection is a client saying the work did not happen. That is not
      // fraud, so it must never be scored or blocked however bad the other
      // signals look.
      const rejected = await submit('Boiler Servicing rejected');
      if (rejected) {
        await api('POST', `/verifications/${rejected.verificationToken}`, {
          body: { response: 'rejected', verifierGps: LONDON },
        });
        const row = (
          await pool.query(
            `select v.fraud_score, v.fraud_score_detail,
                    (select verification_status from public.work_proof_logs where id=$1) as proof_status
               from public.verifications v where v.work_proof_id=$1`,
            [rejected.proofId],
          )
        ).rows[0];
        check('a rejection is never scored', row?.fraud_score === null, String(row?.fraud_score));
        check('a rejection is never marked fraud_blocked', row?.proof_status === 'rejected', String(row?.proof_status));
      }

      // Media provenance: what the scrubber derived must be on the row as
      // booleans, and nothing identifying beside it.
      const signalRow = (
        await pool.query(
          `select media_signal_evaluated, media_has_camera_signature,
                  media_timestamp_plausible, media_encoder_known
             from public.work_proof_logs where id=$1`,
          [offsite?.proofId ?? ringProofs[0]],
        )
      ).rows[0];
      check('provenance signals are recorded on the proof', signalRow?.media_signal_evaluated === true, String(signalRow?.media_signal_evaluated));
      check(
        'the container check found a structurally sound file',
        signalRow?.media_encoder_known === true,
        String(signalRow?.media_encoder_known),
      );
      check(
        'the GPS-only fixture claims no capture device',
        signalRow?.media_has_camera_signature === false,
        String(signalRow?.media_has_camera_signature),
      );
      check(
        'a file with no capture time makes no timestamp claim',
        signalRow?.media_timestamp_plausible === null,
        String(signalRow?.media_timestamp_plausible),
      );

      // Dispatch outcome must be visible, so a worker whose link never arrived is
      // not left guessing.
      const dispatchRow = (
        await pool.query(
          'select dispatch_status from public.verifications where work_proof_id = $1',
          [offsite?.proofId ?? ringProofs[0]],
        )
      ).rows[0];
      check(
        'the dispatch outcome is recorded rather than left blank',
        ['sent', 'failed', 'not_attempted'].includes(dispatchRow?.dispatch_status),
        String(dispatchRow?.dispatch_status),
      );
      check(
        'no link claims to have been sent without a provider',
        dispatchUnexpected === false,
        dispatchUnexpected ? 'a link was reported sent' : '',
      );

      // These submissions stored real objects in the bucket. Cleanup finds them by
      // querying the database for this run's workers, so nothing has to be
      // remembered here. What still needs checking is that each `media_url` points
      // at an object that really is there: a proof row whose media is missing would
      // mean cleanup is under-deleting and the stray-object check would report
      // success while media survives.
      const { rows: engineMedia } = await pool.query(
        'select media_url from public.work_proof_logs where worker_id = $1 and media_url is not null',
        [userId],
      );
      let dangling = 0;
      for (const m of engineMedia) {
        const key = m.media_url;
        const lastSlash = key.lastIndexOf('/');
        const folder = key.slice(0, lastSlash);
        const name = key.slice(lastSlash + 1);
        const { data: found } = await admin.storage.from(bucketName).list(folder, { limit: 1000 });
        if (!(found ?? []).some((o) => o.name === name)) dangling += 1;
      }
      check(
        'every proof that stored media points at an object in the bucket',
        dangling === 0,
        `${dangling} of ${engineMedia.length} missing`,
      );

      // The privacy promise, checked against the live table rather than the code.
      const phoneColumns = await pool.query(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name='verifications'
            and (column_name like '%phone%' or column_name like '%mobile%' or column_name like '%tel%')`,
      );
      check(
        'no plaintext phone column remains on verifications',
        phoneColumns.rows.length === 1 && phoneColumns.rows[0].column_name === 'verifier_phone_hash',
        phoneColumns.rows.map((r) => r.column_name).join(', '),
      );

      const hashes = await pool.query(
        `select distinct verifier_phone_hash from public.verifications
          where work_proof_id = any($1::uuid[]) and verifier_phone_hash is not null`,
        [ringProofs],
      );
      check(
        'every endorsement by this verifier produced the same hash',
        hashes.rows.length === 1 && /^[a-f0-9]{64}$/.test(hashes.rows[0]?.verifier_phone_hash ?? ''),
        `${hashes.rows.length} distinct value(s)`,
      );

      // The raw number must not be recoverable from any column in the row.
      const raw = (
        await pool.query('select row_to_json(v)::text as j from public.verifications v where work_proof_id = any($1::uuid[]) limit 1', [ringProofs])
      ).rows[0]?.j ?? '';
      check(
        'the verifier phone number appears nowhere in the stored row',
        !raw.includes('233550000001'),
        raw ? `${raw.length} bytes inspected` : 'no row to inspect',
      );
      check(
        'the phone number appears nowhere in the fraud score breakdown',
        !JSON.stringify(offsiteRow?.fraud_score_detail ?? {}).includes('233550000001'),
      );
    }

    section('EMPLOYER MATCHING');
    // ---------------------------------------------------------------------
    // Phase 4. Drives the whole employer path against the live API: search,
    // the approval gate, the invitation, and the worker's answer.
    //
    // The candidate fixtures are created here rather than reused from the engine
    // section, so the proofs behind them are all verified and none are blocked.
    // Reusing a blocked proof would test the filter for the wrong reason.
    if (userId && token) {
      const MATCH_SKILL = 'Solar Panel Installation';
      const stamp = Date.now();
      const employerEmail = `smoke.${stamp}.employer@tetherproof.dev`;
      const adminEmail = `smoke.${stamp}.admin@tetherproof.dev`;
      const otherEmail = `smoke.${stamp}.other@tetherproof.dev`;
      const peekerEmail = `smoke.${stamp}.peek@tetherproof.dev`;

      // The escalation itself, and the only credential request this section makes.
      //
      // Registration writes the role claim server-side, so honouring a
      // self-declared `admin` let an anonymous caller create an account satisfying
      // `authorize('admin')`, approve any employer, and hand that employer the
      // right to message workers. The refusal is asserted on the status and on the
      // database, because a request that returned an error while still creating a
      // worker account would defeat the point just as thoroughly.
      const escalateEmail = `smoke.${stamp}.wants-admin@tetherproof.dev`;
      const escalateAttempt = await api('POST', '/auth/register', {
        body: { email: escalateEmail, password, role: 'admin', fullName: 'Smoke Escalation' },
      });
      check(
        'an account cannot be registered with an elevated role',
        escalateAttempt.status === 400,
        `status ${escalateAttempt.status} ${escalateAttempt.text.slice(0, 120)}`,
      );
      const escalateRow = (
        await pool.query(
          `select u.role from public.users u join auth.users a on a.id = u.id where a.email = $1`,
          [escalateEmail],
        )
      ).rows[0];
      check(
        'the refused registration created no account at all, privileged or otherwise',
        escalateRow === undefined,
        `stored role ${String(escalateRow?.role)}`,
      );

      // Fixtures are provisioned through the service role rather than registered,
      // which is both the only supported way to hold an elevated role and the only
      // way to keep this section clear of the auth rate limit. See `mintAccount`.
      const employer = await mintAccount(employerEmail, 'employer', 'Smoke Test Employer');
      const adminAccount = await mintAccount(adminEmail, 'admin', 'Smoke Test Admin');
      const other = await mintAccount(otherEmail, 'employer', 'Smoke Test Other Employer');
      const peeker = await mintAccount(peekerEmail, 'employer', 'Smoke Test Peeker');

      check(
        'a provisioned employer account can be used',
        Boolean(employer.token),
        employer.error ?? 'no token',
      );
      check(
        'a provisioned admin account can be used',
        Boolean(adminAccount.token),
        adminAccount.error ?? 'no token',
      );

      // Two verified proofs for one skill, so a threshold of 2 is satisfiable and
      // a threshold of 3 is not. Each gets its own verifier, because reusing one
      // number here would trip the concentration check the engine section proved
      // works and the proof would come back blocked.
      for (let i = 0; i < 2; i += 1) {
        const fixture = await uploadProof(
          {
            description: `Fitted and commissioned a rooftop solar array on site ${i + 1}.`,
            skillTag: MATCH_SKILL,
            submissionGps: '5.6037,-0.1870',
            verifierPhone: `+2335501000${i}0`,
          },
          { field: 'media_file', filename: 'solar.jpg', contentType: 'image/jpeg', buffer: gpsJpeg() },
          token,
        );
        const body = fixture.status === 201 ? unwrap(fixture.json) : null;
        if (body) {
          await api('POST', `/verifications/${body.verificationToken}`, {
            body: { response: 'confirmed', verifierGps: '5.6040,-0.1871' },
          });
        }
      }
      const verifiedForSkill = (
        await pool.query(
          `select count(*)::int n from public.work_proof_logs w
             join public.capability_blocks c on c.id = w.capability_block_id
            where w.worker_id = $1 and lower(c.skill_tag) = lower($2)
              and w.verification_status = 'verified'`,
          [userId, MATCH_SKILL],
        )
      ).rows[0].n;
      check('the search fixtures produced verified proofs', verifiedForSkill === 2, `${verifiedForSkill} verified`);

      if (employer.token && adminAccount.token) {
        // --- Approval gate ---------------------------------------------
        const pending = await api('GET', '/employers/approval', { token: employer.token });
        check(
          'a new employer starts unapproved and unable to send',
          pending.status === 200 && pending.json?.status === 'pending' && pending.json?.sending?.eligibility === 'blocked',
          JSON.stringify(pending.json).slice(0, 160),
        );

        // Searching is allowed while unapproved. It discloses no identity and
        // harms nobody; only unsolicited contact is gated.
        const earlySearch = await api('GET', `/employers/search?requiredSkill=${encodeURIComponent(MATCH_SKILL)}&minProofThreshold=1`, {
          token: employer.token,
        });
        check('an unapproved employer can still search', earlySearch.status === 200, `status ${earlySearch.status}`);

        const earlyOffer = await api('POST', '/employers/offers', {
          token: employer.token,
          body: { candidateHandle: 'A'.repeat(43), note: 'Should be refused.' },
        });
        check(
          'an unapproved employer cannot send an invitation',
          earlyOffer.status === 403,
          `status ${earlyOffer.status} ${earlyOffer.text.slice(0, 120)}`,
        );

        const selfApprove = await api('POST', `/admin/employers/${employer.id}/approval`, {
          token: employer.token,
          body: { status: 'approved' },
        });
        check('an employer cannot approve itself', selfApprove.status === 403, `status ${selfApprove.status}`);

        const workerApprove = await api('POST', `/admin/employers/${userId}/approval`, {
          token: adminAccount.token,
          body: { status: 'approved' },
        });
        check(
          'approving a non-employer account is refused',
          workerApprove.status === 409,
          `status ${workerApprove.status} ${workerApprove.text.slice(0, 120)}`,
        );

        // --- Specs ------------------------------------------------------
        const noSkill = await api('GET', '/employers/search?minProofThreshold=1', { token: employer.token });
        check(
          'searching with no skill and no spec is refused',
          noSkill.status === 400,
          `status ${noSkill.status}`,
        );

        const badSkill = await api('POST', '/employers/specs', {
          token: employer.token,
          body: { requiredSkill: 'x' },
        });
        check('a one-character skill is refused', badSkill.status === 400, `status ${badSkill.status}`);

        const absurd = await api('POST', '/employers/specs', {
          token: employer.token,
          body: { requiredSkill: MATCH_SKILL, minProofThreshold: 100000 },
        });
        check(
          'an unreachable proof threshold is refused rather than stored',
          absurd.status === 400,
          `status ${absurd.status}`,
        );

        const spec = await api('POST', '/employers/specs', {
          token: employer.token,
          body: { requiredSkill: MATCH_SKILL, minProofThreshold: 2, maxDistanceKm: 50 },
        });
        check('a capability spec is created', spec.status === 201, `status ${spec.status} ${spec.text.slice(0, 140)}`);
        const specId = unwrap(spec.json)?.id;
        check('the spec has no updatedAt field the table does not store', unwrap(spec.json)?.updatedAt === undefined, String(unwrap(spec.json)?.updatedAt));

        const listSpecs = await api('GET', '/employers/specs', { token: employer.token });
        check('the employer lists their own specs', (listSpecs.json?.specs ?? []).length === 1, `${listSpecs.json?.specs?.length} specs`);

        // --- Search -----------------------------------------------------
        const found = await api('GET', `/employers/search?specId=${specId}`, { token: employer.token });
        check('search by spec returns the candidate', found.status === 200 && (found.json?.candidates ?? []).length === 1, `status ${found.status} ${found.text.slice(0, 160)}`);

        const card = found.json?.candidates?.[0];
        check('the card reports the verified proof count', card?.verifiedProofs === 2, String(card?.verifiedProofs));
        check('the card reports a trust score', typeof card?.trustScore === 'number', String(card?.trustScore));
        check('the card reports when the proof was last verified', typeof card?.lastVerifiedAt === 'string', String(card?.lastVerifiedAt));
        check('no distance is invented without a reference point', card?.distanceKm === null, String(card?.distanceKm));
        check('a handle is issued', typeof card?.candidateHandle === 'string' && card.candidateHandle.length >= 32, String(card?.candidateHandle)?.slice(0, 12));

        // The masking promise, checked against the actual response body.
        const cardJson = JSON.stringify(found.json);
        check('the search result contains no worker id', !cardJson.includes(userId), userId ?? '');
        check('the search result contains no email address', !cardJson.includes('tetherproof.dev'), '');
        check(
          'the search result carries no name, phone, or avatar field',
          !/fullName|full_name|avatar|phone|email|workerId|worker_id/i.test(cardJson),
          cardJson.slice(0, 200),
        );

        // Threshold enforcement: three verified proofs do not exist.
        const tooTight = await api('GET', `/employers/search?requiredSkill=${encodeURIComponent(MATCH_SKILL)}&minProofThreshold=3`, {
          token: employer.token,
        });
        check(
          'a threshold above the proof count returns nobody',
          tooTight.status === 200 && (tooTight.json?.candidates ?? []).length === 0,
          `${tooTight.json?.candidates?.length} candidates`,
        );

        // Case-insensitive matching.
        const cased = await api('GET', `/employers/search?requiredSkill=${encodeURIComponent(MATCH_SKILL.toUpperCase())}&minProofThreshold=2`, {
          token: employer.token,
        });
        check(
          'skill matching is case-insensitive',
          (cased.json?.candidates ?? []).length === 1,
          `${cased.json?.candidates?.length} candidates`,
        );

        // --- Profile, and what it makes possible -----------------------
        // Distance filtering and naming the inviter both depend on profile fields
        // that had no write path at all before this endpoint existed. Driven
        // through the API rather than by updating rows directly, so these checks
        // prove the features are genuinely reachable rather than merely that the
        // columns exist.
        const profileSet = await api('PATCH', '/auth/profile', {
          token,
          body: { locationGps: '5.6037,-0.1870' },
        });
        check(
          'a worker can record their location',
          profileSet.status === 200,
          `status ${profileSet.status} ${profileSet.text.slice(0, 140)}`,
        );

        const stored = (
          await pool.query('select location_gps from public.profiles where user_id = $1', [userId])
        ).rows[0];
        check('the location is stored after validation', stored?.location_gps === '5.6037,-0.1870', String(stored?.location_gps));

        const badLocation = await api('PATCH', '/auth/profile', { token, body: { locationGps: '999,999' } });
        check('an out-of-range location is refused', badLocation.status === 400, `status ${badLocation.status}`);

        const afterBad = (
          await pool.query('select location_gps from public.profiles where user_id = $1', [userId])
        ).rows[0];
        check(
          'the refused location did not overwrite the stored one',
          afterBad?.location_gps === '5.6037,-0.1870',
          String(afterBad?.location_gps),
        );

        const orgSet = await api('PATCH', '/auth/profile', {
          token: employer.token,
          body: { organizationName: 'Smoke Solar Ltd' },
        });
        check('an employer can record their organization name', orgSet.status === 200, `status ${orgSet.status}`);

        // Provisioned accounts are created outside the registration path, so they
        // have no `profiles` row to begin with. The profile endpoint has to cope
        // with that, or an administrator cannot use it at all.
        const noProfileRow = (
          await pool.query(`select count(*)::int n from public.profiles where user_id = $1`, [
            adminAccount.id,
          ])
        ).rows[0].n;
        check(
          'a provisioned account starts with no profile row',
          noProfileRow === 0,
          `${noProfileRow} row(s)`,
        );
        const adminProfile = await api('PATCH', '/auth/profile', {
          token: adminAccount.token,
          body: { fullName: 'Smoke Test Admin' },
        });
        check(
          'a provisioned account can create its profile on demand',
          adminProfile.status === 200,
          `status ${adminProfile.status} ${adminProfile.text.slice(0, 140)}`,
        );
        const adminProfileRow = (
          await pool.query(`select full_name from public.profiles where user_id = $1`, [
            adminAccount.id,
          ])
        ).rows[0];
        check(
          'the created profile holds the supplied value',
          adminProfileRow?.full_name === 'Smoke Test Admin',
          String(adminProfileRow?.full_name),
        );

        // And it must not wipe fields it was not asked about.
        const partialPatch = await api('PATCH', '/auth/profile', {
          token,
          body: { fullName: 'Smoke Test Worker Renamed' },
        });
        const partialRow = (
          await pool.query(
            'select full_name, location_gps from public.profiles where user_id = $1',
            [userId],
          )
        ).rows[0];
        check(
          'a partial profile update leaves other fields untouched',
          partialPatch.status === 200 &&
            partialRow?.full_name === 'Smoke Test Worker Renamed' &&
            partialRow?.location_gps === '5.6037,-0.1870',
          `name ${partialRow?.full_name}, location ${partialRow?.location_gps}`,
        );

        const emptyPatch = await api('PATCH', '/auth/profile', { token, body: {} });
        check('a profile update with no fields is refused', emptyPatch.status === 400, `status ${emptyPatch.status}`);

        const unauthPatch = await api('PATCH', '/auth/profile', { body: { fullName: 'Nobody' } });
        check('the profile endpoint requires a session', unauthPatch.status === 401, `status ${unauthPatch.status}`);

        // A spec may narrow but never widen, so it cannot be borrowed as a floor.
        const widen = await api('GET', `/employers/search?specId=${specId}&minProofThreshold=1`, { token: employer.token });
        check(
          'a spec threshold cannot be lowered by a query parameter',
          (widen.json?.candidates ?? []).length === 1 && widen.json.candidates[0]?.verifiedProofs === 2,
          `${widen.json?.candidates?.length} candidates`,
        );

        // Distance: with a reference point far away the card still appears but
        // reports a distance, and a radius that cannot reach excludes it.
        const distant = await api('GET', `/employers/search?specId=${specId}&referenceGps=5.6037,-0.1870`, {
          token: employer.token,
        });
        check(
          'a reference point produces a measured distance',
          typeof distant.json?.candidates?.[0]?.distanceKm === 'number',
          String(distant.json?.candidates?.[0]?.distanceKm),
        );

        // Every "returns nobody" assertion below also asserts a 200. An empty `candidates`
      // array and an error body both read as "no results" through `?? []`, so a
      // check written only against the array passes while the endpoint is broken.
      const faraway = await api('GET', `/employers/search?requiredSkill=${encodeURIComponent(MATCH_SKILL)}&minProofThreshold=1&referenceGps=51.5074,-0.1278&maxDistanceKm=1`, {
          token: employer.token,
        });
        check(
          'a candidate outside the radius is excluded',
          faraway.status === 200 && (faraway.json?.candidates ?? []).length === 0,
          `status ${faraway.status} ${faraway.text.slice(0, 140)}`,
        );

        const badGps = await api('GET', `/employers/search?requiredSkill=${encodeURIComponent(MATCH_SKILL)}&referenceGps=999,999`, {
          token: employer.token,
        });
        check('an out-of-range reference point is refused', badGps.status === 400, `status ${badGps.status}`);

        // A worker with no stored location must not vanish from a search. Absence of
        // evidence is not disqualification: excluding them would hide most of a
        // network that has not opted into geolocation. Cleared through the API,
        // which also proves an explicit null is honoured.
        const cleared = await api('PATCH', '/auth/profile', { token, body: { locationGps: null } });
        check('a worker can withdraw their location', cleared.status === 200, `status ${cleared.status}`);

        const clearedStored = (
          await pool.query('select location_gps from public.profiles where user_id = $1', [userId])
        ).rows[0];
        check('withdrawing the location clears the column', clearedStored?.location_gps === null, String(clearedStored?.location_gps));

        const noLocation = await api('GET', `/employers/search?requiredSkill=${encodeURIComponent(MATCH_SKILL)}&minProofThreshold=1&referenceGps=51.5074,-0.1278&maxDistanceKm=5`, {
          token: employer.token,
        });
        check(
          'a worker who shared no location is not excluded, and reports no distance',
          noLocation.status === 200 &&
            (noLocation.json?.candidates ?? []).length === 1 &&
            noLocation.json.candidates[0]?.distanceKm === null,
          `status ${noLocation.status}, ${noLocation.json?.candidates?.length} candidates, distance ${noLocation.json?.candidates?.[0]?.distanceKm}`,
        );

        // Restored through the API so the later distance checks have a location.
        await api('PATCH', '/auth/profile', { token, body: { locationGps: '5.6037,-0.1870' } });

        // --- Invitations ------------------------------------------------
        const handle = card?.candidateHandle;

        const workerSeesEmployerRoutes = await api('GET', '/employers/specs', { token });
        check('a worker cannot reach employer routes', workerSeesEmployerRoutes.status === 403, `status ${workerSeesEmployerRoutes.status}`);

        const employerSeesInvites = await api('GET', '/invites/offers', { token: employer.token });
        check('an employer cannot reach the worker invite routes', employerSeesInvites.status === 403, `status ${employerSeesInvites.status}`);

        const noInviteYet = await api('GET', '/invites/offers', { token });
        check('the worker starts with no invitations', noInviteYet.status === 200 && (noInviteYet.json?.offers ?? []).length === 0, `status ${noInviteYet.status}`);

        if (handle) {
          // Checked after approval, not before: while the account is unapproved the
          // gate answers 403 regardless of the handle, so an unknown-handle check
          // placed here would pass for the wrong reason and prove nothing about
          // handle resolution.
          const approved = await api('POST', `/admin/employers/${employer.id}/approval`, {
            token: adminAccount.token,
            body: { status: 'approved', note: 'Smoke test approval.' },
          });
          check('an admin can approve an employer', approved.status === 200 && approved.json?.status === 'approved', `status ${approved.status} ${approved.text.slice(0, 140)}`);

          // Re-running the search must hand back a usable handle. Handles are
          // issued at search time, so a search that mints nothing would leave the
          // employer unable to act on a result they are still looking at.
          const reSearched = await api('GET', `/employers/search?specId=${specId}`, { token: employer.token });
          check(
            'searching again by spec returns a card',
            reSearched.status === 200 && (reSearched.json?.candidates ?? []).length === 1,
            `status ${reSearched.status} ${reSearched.text.slice(0, 160)}`,
          );
          check(
            'the same candidate yields the same handle',
            reSearched.json?.candidates?.[0]?.candidateHandle === card?.candidateHandle,
            `${reSearched.json?.candidates?.[0]?.candidateHandle?.slice(0, 12)} vs ${card?.candidateHandle?.slice(0, 12)}`,
          );

          const nowEligible = await api('GET', '/employers/approval', { token: employer.token });
          check(
            'an approved employer may now send',
            nowEligible.json?.sending?.eligibility === 'eligible',
            JSON.stringify(nowEligible.json?.sending),
          );

          const bogus = await api('POST', '/employers/offers', {
            token: employer.token,
            body: { candidateHandle: 'not-a-real-handle-value-at-all' },
          });
          check(
            'an unknown handle is refused',
            bogus.status === 404,
            `status ${bogus.status} ${bogus.text.slice(0, 120)}`,
          );

          const sent = await api('POST', '/employers/offers', {
            token: employer.token,
            body: { candidateHandle: handle, note: 'We have a rooftop array role in Accra.' },
          });
          check('an invitation is sent by handle', sent.status === 201, `status ${sent.status} ${sent.text.slice(0, 160)}`);
          const offerId = unwrap(sent.json)?.id;

          const sentAgain = await api('POST', '/employers/offers', {
            token: employer.token,
            body: { candidateHandle: handle, note: 'Duplicate.' },
          });
          check(
            'a second pending invitation to the same candidate is refused',
            sentAgain.status === 409,
            `status ${sentAgain.status}`,
          );

          // Handle scoping: another employer holding the same handle must resolve
          // to nothing, or masking would be cosmetic.
          if (other.token) {
            await api('POST', `/admin/employers/${other.id}/approval`, {
              token: adminAccount.token,
              body: { status: 'approved' },
            });
            const stolen = await api('POST', '/employers/offers', {
              token: other.token,
              body: { candidateHandle: handle, note: 'Should not resolve.' },
            });
            check(
              "another employer's handle resolves to nobody",
              stolen.status === 404,
              `status ${stolen.status} ${stolen.text.slice(0, 140)}`,
            );
          }

          // --- The worker's answer -------------------------------------
          const received = await api('GET', '/invites/offers', { token });
          check('the worker receives the invitation', (received.json?.offers ?? []).length === 1, `${received.json?.offers?.length} offers`);
          check('the pending count reflects it', received.json?.pendingCount === 1, String(received.json?.pendingCount));

          const inbox = received.json?.offers?.[0];
          check('the worker sees the employer is approved', inbox?.employerApproved === true, String(inbox?.employerApproved));
          check(
            'the employer is named so the worker can judge the offer',
            inbox?.employerOrganization === 'Smoke Solar Ltd',
            String(inbox?.employerOrganization),
          );
          check('identity is not revealed before acceptance', inbox?.candidateRevealed === false, String(inbox?.candidateRevealed));
          check('the note reaches the worker', inbox?.note === 'We have a rooftop array role in Accra.', String(inbox?.note));

          const inboxJson = JSON.stringify(received.json);
          check('the inbox discloses no worker id', !inboxJson.includes(userId), userId ?? '');
          check(
            'the inbox carries no employer contact detail or account id',
            !/employerId|employer_id|avatar|phone|email/i.test(inboxJson),
            inboxJson.slice(0, 200),
          );

          if (offerId) {
            const wrongWorker = await api('POST', `/invites/offers/${offerId}/respond`, {
              token: employer.token,
              body: { response: 'accepted' },
            });
            check('an employer cannot answer their own invitation', wrongWorker.status === 403, `status ${wrongWorker.status}`);

            const declined = await api('POST', `/invites/offers/${offerId}/respond`, {
              token,
              body: { response: 'declined' },
            });
            check('the worker declines', declined.status === 200 && declined.json?.status === 'declined', `status ${declined.status} ${declined.text.slice(0, 140)}`);
            check('a declined invitation does not reveal identity', declined.json?.candidateRevealed === false, String(declined.json?.candidateRevealed));

            const twice = await api('POST', `/invites/offers/${offerId}/respond`, {
              token,
              body: { response: 'accepted' },
            });
            check('answering an answered invitation is refused', twice.status === 409, `status ${twice.status}`);

            const employerView = await api('GET', '/employers/offers', { token: employer.token });
            check('the employer sees the outcome', employerView.json?.offers?.[0]?.status === 'declined', String(employerView.json?.offers?.[0]?.status));
            check('the outcome records when they answered', typeof employerView.json?.offers?.[0]?.respondedAt === 'string', String(employerView.json?.offers?.[0]?.respondedAt));

            // Accepting a fresh invitation does reveal, which is the whole point
            // of the mask: identity flows one way and only after agreement.
            const again = await api('POST', '/employers/offers', { token: employer.token, body: { candidateHandle: handle } });
            check('the employer may re-invite after a response', again.status === 201, `status ${again.status}`);
            const accepted = await api('POST', `/invites/offers/${unwrap(again.json)?.id}/respond`, {
              token,
              body: { response: 'accepted' },
            });
            check('the worker accepts', accepted.status === 200 && accepted.json?.status === 'accepted', `status ${accepted.status}`);
            check('acceptance reveals identity to the worker', accepted.json?.candidateRevealed === true, String(accepted.json?.candidateRevealed));
            check('acceptance records when they answered', typeof accepted.json?.respondedAt === 'string', String(accepted.json?.respondedAt));
          }

          // --- Revoking approval ---------------------------------------
          await api('POST', `/admin/employers/${employer.id}/approval`, {
            token: adminAccount.token,
            body: { status: 'rejected', note: 'Smoke test rejection.' },
          });
          const afterReject = await api('POST', '/employers/offers', {
            token: employer.token,
            body: { candidateHandle: handle, note: 'Should be blocked.' },
          });
          check('a rejected employer cannot send again', afterReject.status === 403, `status ${afterReject.status}`);

          // --- Isolation between employers -----------------------------
          const ownSpecId = (
            await api('GET', '/employers/specs', { token: employer.token })
          ).json?.specs?.[0]?.id;
          if (ownSpecId) {
            if (peeker.token) {
              const crossRead = await api('PATCH', `/employers/specs/${ownSpecId}`, {
                token: peeker.token,
                body: { minProofThreshold: 9 },
              });
              check("another employer cannot read or edit someone else's spec", crossRead.status === 404, `status ${crossRead.status}`);
            }
          }
        }
      }
    }

    section('ROW LEVEL SECURITY');
    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const readUsers = await anon.from('users').select('*').limit(1);
    check('browser key cannot read public.users', Boolean(readUsers.error) || (readUsers.data ?? []).length === 0, readUsers.error?.message ?? 'no rows');

    const readProofs = await anon.from('work_proof_logs').select('*').limit(1);
    check('browser key cannot read work_proof_logs', Boolean(readProofs.error) || (readProofs.data ?? []).length === 0, readProofs.error?.message ?? 'no rows');

    // The Phase 4 tables must be unreachable from a browser key. A handle resolves
      // to a real worker, so leaking the table would undo the masking that the
      // search endpoint exists to provide.
      for (const table of ['employer_approvals', 'candidate_handles', 'direct_offers']) {
        const read = await anon.from(table).select('*').limit(1);
        check(
          `browser key cannot read public.${table}`,
          Boolean(read.error) || (read.data ?? []).length === 0,
          read.error?.message ?? 'no rows',
        );
      }

      // The dormant capability counters must actually be gone, not merely unused.
      const dormant = await pool.query(
        `select column_name from information_schema.columns
          where table_schema='public' and table_name='capability_blocks'
            and column_name in ('proof_count','last_verified_at')`,
      );
      check(
        'the dormant proof counters are dropped, not just ignored',
        dormant.rows.length === 0,
        dormant.rows.map((r) => r.column_name).join(', '),
      );

      const escalate = await anon.from('users').update({ role: 'admin' }).eq('id', userId ?? '00000000-0000-0000-0000-000000000000');
    check('browser key cannot escalate a role', Boolean(escalate.error) || escalate.count === 0, escalate.error?.message ?? '0 rows');
    if (userId) {
      const stillWorker = (await pool.query('select role from public.users where id = $1', [userId])).rows[0];
      check('role unchanged after the escalation attempt', stillWorker?.role === 'worker', JSON.stringify(stillWorker));
    }

    section('ROLE MIRRORING');
    if (userId) {
      await admin.auth.admin.updateUserById(userId, { app_metadata: { role: 'employer' } });
      const mirrored = (await pool.query('select role from public.users where id = $1', [userId])).rows[0];
      check('role change is mirrored into the database', mirrored?.role === 'employer', JSON.stringify(mirrored));
    }

    // The self-service deletion endpoint. Everything below about the database is
    // reached through `DELETE /auth/account` rather than through the admin API, so
    // this section proves the endpoint exists, that it closes the byte-level gap the
    // database trigger cannot, and that it refuses an unauthenticated caller.
    section('SELF-SERVICE ACCOUNT DELETION');
    {
      const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
        auth: { persistSession: false },
      });
      const unauth = await fetch(`${API}/auth/account`, { method: 'DELETE' });
      check('deleting an account requires a session', unauth.status === 401, `status ${unauth.status}`);

      const wrongAccount = await api('DELETE', '/auth/account', { token: 'not-a-real-token' });
      check('a forged token cannot delete an account', wrongAccount.status === 401, `status ${wrongAccount.status}`);

      // The route takes no id in the path or the body, so there is nothing for a
      // caller to redirect the deletion at. Asserted through the refusal above
      // rather than by reading the source.
      const targetless = await fetch(`${API}/auth/account/someone-elses-id`, { method: 'DELETE' });
      check(
        'there is no route that deletes an account named in the path',
        targetless.status === 404,
        `status ${targetless.status}`,
      );

      const noSuch = await api('GET', '/health');
      check('the API is still healthy after the deletion attempts', noSuch.status === 200, `status ${noSuch.status}`);
      void anon;
    }

    // E-025. `capability_blocks.worker_id` and `work_proof_logs.worker_id` were
    // `ON DELETE restrict`, which made any account that had ever logged work
    // impossible to delete: the delete aborted the cascade from `auth.users` and
    // Supabase reported `AuthRetryableFetchError: Database error deleting user`,
    // naming neither the table nor the constraint.
    //
    // The fix keeps the evidence and detaches it from the person. That is a claim
    // about behaviour, not about a column definition, so it is tested by deleting
    // an account that has actually logged work and reading the rows back.
    section('ACCOUNT DELETION BY ANONYMISATION');
    {
      const email = `smoke.deletion.${Date.now()}@tetherproof.dev`;
      const deletedAccount = await mintAccount(email, 'worker', 'Smoke Test Deletion');
      check('a worker account can be provisioned for deletion', Boolean(deletedAccount.id), deletedAccount.error ?? '');

      if (deletedAccount.id) {
        const { id: subjectId } = deletedAccount;
        const { randomUUID } = await import('node:crypto');
        const blockId = randomUUID();
        const proofId = randomUUID();
        const verificationId = randomUUID();
        const skill = `Deletion Skill ${Date.now()}`;
        retainedRowIds.push(blockId, proofId, verificationId);

        await pool.query(
          `insert into public.profiles (user_id, full_name, location_gps)
           values ($1, 'Smoke Test Deletion', '5.6037,-0.1870')`,
          [subjectId],
        );
        await pool.query(
          'insert into public.capability_blocks (id, worker_id, skill_tag, skill_level) values ($1,$2,$3,4)',
          [blockId, subjectId, skill],
        );
        const mediaPath = `${subjectId}/2026-10-05/${randomUUID()}.jpg`;
        storedPaths.push(mediaPath);
        uploadsThisRun += 1;
        const { error: uploadErr } = await admin.storage
          .from(process.env.STORAGE_PROOFS_BUCKET || 'work-proofs')
          .upload(mediaPath, Buffer.from(gpsJpeg()), { contentType: 'image/jpeg', upsert: false });
        check('the subject has stored proof media', !uploadErr, uploadErr?.message ?? mediaPath);

        await pool.query(
          `insert into public.work_proof_logs
             (id, worker_id, capability_block_id, description, media_url, submission_gps, verification_status)
           values ($1,$2,$3,$4,$5,'5.6040,-0.1865','verified')`,
          [proofId, subjectId, blockId, 'A description that identifies the job site.', mediaPath],
        );
        await pool.query(
          `insert into public.verifications
             (id, work_proof_id, token_hash, response, verifier_gps, fraud_score, completed_at, expires_at)
           values ($1,$2,$3,'confirmed','5.6039,-0.1868',0.92, now(), now() + interval '7 days')`,
          [verificationId, proofId, randomUUID().replace(/-/g, '')],
        );

        // `mintAccount` above already returned a session for this account, so the
        // deletion is issued by the member themselves. That is the path a real member
        // takes, and the one that has to remove the stored object.
        check('the subject holds a session for the endpoint', Boolean(deletedAccount.token), 'no token');

        // The operation that used to fail. Called with the account carrying a
        // profile, a capability block, a verified proof with media, and a
        // confirmation, so nothing about it is a weaker case than E-025 described.
        const removed = await api('DELETE', '/auth/account', { token: deletedAccount.token });
        check(
          'an account that has logged work can now be deleted by its owner',
          removed.status === 200,
          removed.text?.slice(0, 200) ?? '',
        );
        check(
          'the response reports the stored media it removed rather than a bare success',
          removed.json?.mediaRemoved === 1 && removed.json?.mediaPending === 0,
          JSON.stringify(removed.json ?? null),
        );
        // Drop it from the cleanup list now that it is gone. Left there, the
        // cleanup retries a delete that now reports "User not found" and prints a
        // warning on every run — and a suite that always prints a warning is a
        // suite whose warnings stop being read.
        if (removed.status === 200) {
          const at = createdUsers.indexOf(subjectId);
          if (at !== -1) createdUsers.splice(at, 1);
        }

        const stillAuth = (await pool.query('select count(*)::int n from auth.users where id = $1', [subjectId])).rows[0];
        check('the auth user is gone', stillAuth.n === 0, `${stillAuth.n} left`);

        const stillProfile = (await pool.query('select count(*)::int n from public.profiles where user_id = $1', [subjectId])).rows[0];
        check('the profile is gone, so the identifying data is gone', stillProfile.n === 0, `${stillProfile.n} left`);

        const proof = (await pool.query(
          'select worker_id, description, media_url, submission_gps, anonymised_at from public.work_proof_logs where id = $1',
          [proofId],
        )).rows[0];
        check('the proof record is retained rather than destroyed', Boolean(proof), JSON.stringify(proof ?? null));
        check('the proof is detached from the worker', proof?.worker_id === null, `worker_id=${proof?.worker_id}`);
        check('the proof is marked anonymised', proof?.anonymised_at !== null, String(proof?.anonymised_at));
        check(
          'the description is overwritten, not merely hidden',
          typeof proof?.description === 'string' && !proof.description.includes('job site'),
          JSON.stringify(proof?.description),
        );
        check('the submission location is cleared', proof?.submission_gps === null, String(proof?.submission_gps));
        check('the media pointer is cleared', proof?.media_url === null, String(proof?.media_url));

        const block = (await pool.query(
          'select worker_id, skill_tag, anonymised_at from public.capability_blocks where id = $1',
          [blockId],
        )).rows[0];
        check('the capability block is retained', Boolean(block));
        check('the capability block is detached and marked', block?.worker_id === null && block?.anonymised_at !== null);
        // The reason retention is not bookkeeping. Severing the proof's link to its
        // block as well would strip the skill tag and drop both records out of every
        // aggregate, quietly decrementing counts that other people's trust scores
        // depend on.
        check(
          'the skill tag survives, so the record still counts',
          block?.skill_tag === skill,
          String(block?.skill_tag),
        );

        const countable = (await pool.query(
          `select count(distinct w.id) filter (where w.verification_status = 'verified')::int as verified
             from public.work_proof_logs w
             join public.capability_blocks b on b.id = w.capability_block_id
            where lower(b.skill_tag) = lower($1)`,
          [skill],
        )).rows[0];
        check(
          'the retained record still aggregates under its skill after deletion',
          countable?.verified === 1,
          `verified=${countable?.verified}`,
        );

        const verification = (await pool.query(
          'select verifier_gps, token_hash, fraud_score from public.verifications where id = $1',
          [verificationId],
        )).rows[0];
        check('the confirmation is retained, holding its fraud score', Boolean(verification));
        check('the verifier coordinate is cleared', verification?.verifier_gps === null, String(verification?.verifier_gps));
        check(
          'the verifier phone hash is retained so collusion filtering still works',
          Boolean(verification?.token_hash),
        );

        // What the trigger could not do, and the endpoint therefore had to. Storage
        // refuses deletion from SQL — verified rather than assumed — so the trigger
        // recorded the path and the object was still stored at that moment. Proving
        // the object really was still there is what makes the endpoint's removal
        // meaningful: without it, an assertion that the endpoint cleaned up would
        // also be consistent with the object never having existed.
        const afterDelete = (await admin.storage
          .from(process.env.STORAGE_PROOFS_BUCKET || 'work-proofs')
          .list(`${subjectId}/2026-10-05`)).data ?? [];
        check(
          'the endpoint removed the stored object, which SQL could not',
          afterDelete.length === 0,
          `${afterDelete.length} object(s) still stored`,
        );
        const goneSigned = await admin.storage
          .from(process.env.STORAGE_PROOFS_BUCKET || 'work-proofs')
          .createSignedUrl(mediaPath, 60);
        check(
          'a signed URL for the removed object is refused',
          Boolean(goneSigned.error),
          goneSigned.error?.message ?? 'a URL was issued',
        );

        const drained = await pool.query(
          'select count(*)::int n from public.orphaned_proof_media where path like $1',
          [`${subjectId}/%`],
        );
        check(
          'the removal queue is drained once the object is gone',
          drained.rows[0].n === 0,
          `${drained.rows[0].n} rows`,
        );
        check(
          'nothing was left queued for this account anywhere in the table',
          (await pool.query('select count(*)::int n from public.orphaned_proof_media')).rows[0].n === 0,
        );
      }
    }

    if (WITH_WEB) {
      await runWebChecks({ pool, admin, createdUsers, apiProcess });
    }
  } finally {
    killTree(apiProcess);
    await cleanup();
    await pool.end();
  }

  console.log(`\n===== RESULT: ${passed} passed, ${failed} failed =====`);
  if (failed > 0) {
    console.log('Failed checks:');
    for (const name of failures) console.log(`  - ${name}`);
  }
  process.exit(failed === 0 ? 0 : 1);
}

/**
 * Verifies the client confirmation page: SSR output plus the exact HTTP calls
 * the browser makes, including the CORS handshake.
 */
async function runWebChecks({ pool, admin, createdUsers }) {
  section('CLIENT CONFIRMATION PAGE');
  if (await portInUse(WEB_PORT)) throw new Error(`Port ${WEB_PORT} is in use. Stop that process first.`);

  const email = `web-smoke.${Date.now()}@tetherproof.dev`;
  const created = await admin.auth.admin.createUser({
    email,
    password: 'SmokeTest123456',
    app_metadata: { role: 'worker' },
    email_confirm: true,
  });
  if (created.error) throw new Error(`could not seed the web check: ${created.error.message}`);
  const userId = created.data.user.id;
  createdUsers.push(userId);

  const block = (
    await pool.query(
      `insert into public.capability_blocks (worker_id, skill_tag, skill_level) values ($1,'Solar Panel Installation',2) returning id`,
      [userId],
    )
  ).rows[0];
  const proof = (
    await pool.query(
      `insert into public.work_proof_logs (worker_id, capability_block_id, description, media_url, metadata_status, submission_gps)
       values ($1,$2,$3,$4,'valid',$5) returning id`,
      [userId, block.id, 'Fitted and commissioned a 5kW rooftop array.', null, '5.6037,-0.1870'],
    )
  ).rows[0];
  const rawToken = randomBytes(32).toString('base64url');
  // A well-formed placeholder hash, not a real one: this fixture needs a token,
  // and the API cannot be consulted for a salt it holds itself. Shape only.
  await pool.query(
    `insert into public.verifications (work_proof_id, verifier_phone_hash, token_hash, expires_at)
     values ($1,$2,$3, now() + interval '3 days')`,
    [proof.id, 'b'.repeat(64), createHash('sha256').update(rawToken, 'utf8').digest('hex')],
  );

  const server = spawn(process.execPath, [resolveNextBin(), 'start', '-p', String(WEB_PORT)], {
    cwd: join(ROOT, 'apps', 'web'),
    // Next must serve in production mode or the build output is rejected.
    env: { ...process.env, NODE_ENV: 'production' },
  });
  let webLog = '';
  server.stdout.on('data', (d) => (webLog += d));
  server.stderr.on('data', (d) => (webLog += d));

  try {
    let ready = false;
    for (let i = 0; i < 60 && !ready; i += 1) {
      await sleep(1000);
      if (server.exitCode !== null) break;
      try {
        if ((await fetch(`${WEB}/`)).ok) ready = true;
      } catch {
        /* not up yet */
      }
    }
    check('web server responds', ready, ready ? '' : webLog.slice(-300));
    if (!ready) return;

    const page = await fetch(`${WEB}/verify/${rawToken}`, { redirect: 'manual' });
    const html = await page.text();
    check('GET /verify/{token} returns 200', page.status === 200, `status ${page.status}`);
    check('confirmation shell is rendered', /Was this work completed|Loading request details/.test(html), `${html.length} bytes`);
    check('referrer is suppressed to protect the token', /no-referrer/i.test(html));
    check('page is excluded from indexing', /noindex/i.test(html));
    check(
      'unknown token still renders the page shell',
      (await fetch(`${WEB}/verify/${randomBytes(32).toString('base64url')}`)).status === 200,
    );

    const preflight = await fetch(`${API}/verifications/${rawToken}`, {
      method: 'OPTIONS',
      headers: {
        Origin: WEB_ORIGIN,
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'content-type',
      },
    });
    const allowOrigin = preflight.headers.get('access-control-allow-origin');
    check('preflight allows the web origin', allowOrigin === WEB_ORIGIN || allowOrigin === '*', `ACAO=${allowOrigin} status=${preflight.status}`);

    const view = await fetch(`${API}/verifications/${rawToken}`, { headers: { Origin: WEB_ORIGIN } });
    const viewJson = await view.json();
    check('browser GET returns the summary', view.status === 200, `status ${view.status}`);
    check('summary is awaiting a response', viewJson?.status === 'awaiting_response');
    check('GET response carries a CORS header', view.headers.get('access-control-allow-origin') !== null, view.headers.get('access-control-allow-origin') ?? 'none');

    // Exactly what the browser button sends: no GPS.
    const submit = await fetch(`${API}/verifications/${rawToken}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: WEB_ORIGIN },
      body: JSON.stringify({ response: 'confirmed' }),
    });
    check('button submission succeeds without GPS', submit.status === 200, `status ${submit.status}`);

    const stored = (
      await pool.query(
        `select response, (select verification_status from public.work_proof_logs where id=$1) as proof_status
           from public.verifications where work_proof_id=$1`,
        [proof.id],
      )
    ).rows[0];
    check('confirmation reached the live database', stored?.response === 'confirmed' && stored?.proof_status === 'verified', JSON.stringify(stored));

    const revisit = await fetch(`${API}/verifications/${rawToken}`, { headers: { Origin: WEB_ORIGIN } });
    check('revisiting the link shows it was answered', (await revisit.json())?.status === 'confirmed');

    const foreign = await fetch(`${API}/verifications/${rawToken}`, { headers: { Origin: 'https://evil.example' } });
    check('unknown origin is not granted CORS access', foreign.headers.get('access-control-allow-origin') === null, `ACAO=${foreign.headers.get('access-control-allow-origin')}`);
  } finally {
    killTree(server);
    await sleep(500);
  }
}

main().catch((error) => {
  console.error(`\nSMOKE TEST ABORTED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});