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

// Any path that ends the process without reaching the RESULT line Ã¢â‚¬â€ an early
// return, an abort Ã¢â‚¬â€ must still exit non-zero. The boot failure below used to
// `return` out of main(), which ran the finally block and then skipped the
// RESULT/exit logic, so Node ended the process with code 0 after printing
// FAIL: a gate that can go green after failing. Once a check has run, the
// only legitimate exit-0 path is the RESULT line setting `finished`.
let finished = false;
process.on('exit', (code) => {
  const started = passed + failed > 0;
  if (code === 0 && !finished && (failed > 0 || started)) process.exit(1);
});

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
   * `worker_id` by design, so the cleanup below Ã¢â‚¬â€ which is scoped by owner Ã¢â‚¬â€ cannot
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
   * the bytes are Ã¢â‚¬â€ once the row is gone the path is unrecoverable. Then the rows,
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

    // Phase 4b rows. `trainer_students` references both parties, so a delete keyed
    // on one side would leave the other's row behind to block the auth delete.
    // `micro_credentials` references a student with `set null` rather than a
    // cascade, so it has to be removed explicitly — a retained credential is
    // correct behaviour for a real account deletion, but this run's accounts are
    // fixtures and the suite is required to leave nothing behind.
    //
    // Each delete tolerates a missing table, because teardown runs on the failure
    // path too: a run that aborted before migration 0011 was applied must still be
    // able to clean up the accounts it created, and a missing relation must not
    // leave the whole teardown half-done. The pre-flight check is where the tables
    // being present is asserted.
    for (const t of ['trainer_students', 'micro_credentials']) {
      try {
        await pool.query(
          `delete from public.${t}
             where trainer_id = any($1::uuid[])
                or student_id = any($1::uuid[])
                or issued_by = any($1::uuid[])`,
          [ids],
        );
      } catch (error) {
        if (!/does not exist/i.test(error.message)) throw error;
      }
    }
    try {
      await pool.query(
        'delete from public.trainer_enrolment_codes where trainer_id = any($1::uuid[])',
        [ids],
      );
    } catch (error) {
      if (!/does not exist/i.test(error.message)) throw error;
    }

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
   * bucket check on every future run Ã¢â‚¬â€ and a check that is always red stops being
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
      // this check would count every deliberately retained record as a leak Ã¢â‚¬â€ and
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
      // The roster and the enrolment code cascade from their owner, so a row with no
      // live account on either side is a leak rather than a retained record. Both
      // parties are checked on the roster: a half-orphaned entry would name a student
      // who no longer exists.
      //
      // Skipped entirely when migration 0011 has not been applied. Pre-flight
      // already fails for that, and a query against a missing relation here would
      // throw and abandon the whole cleanup section — taking with it the orphan
      // checks for every other table, which is the opposite of what a failing run
      // should do.
      const { rows: trainerTables } = await pool.query(
        `select to_regclass('public.trainer_students')::text as t`,
      );
      if (trainerTables[0]?.t) {
        const { rows: rosterOrphans } = await pool.query(
          `select count(*)::int n from public.trainer_students t
             where not exists (select 1 from auth.users u where u.id = t.trainer_id)
                or not exists (select 1 from auth.users u where u.id = t.student_id)`,
        );
        check('no orphaned rows left in public.trainer_students', rosterOrphans[0].n === 0, `${rosterOrphans[0].n} rows`);

        const { rows: codeOrphans } = await pool.query(
          `select count(*)::int n from public.trainer_enrolment_codes t
             where not exists (select 1 from auth.users u where u.id = t.trainer_id)`,
        );
        check('no orphaned rows left in public.trainer_enrolment_codes', codeOrphans[0].n === 0, `${codeOrphans[0].n} rows`);

        // A credential is retained on account deletion with a null `student_id`,
        // the same treatment a worker's proofs get, so the predicate here is on the
        // issuer only. A null student is the anonymised state, not a leak — counting
        // it as one would flag every deliberately retained record.
        const { rows: orphanCredentials } = await pool.query(
          `select count(*)::int n from public.micro_credentials t
             where not exists (select 1 from auth.users u where u.id = t.trainer_id)`,
        );
        check(
          'no orphaned rows left in public.micro_credentials',
          orphanCredentials[0].n === 0,
          `${orphanCredentials[0].n} rows`,
        );
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
      // This table is a queue, not a bucket: a row means "this object existed, the
      // proof row that pointed at it is gone, remove these bytes". It is drained by
      // the deletion path, which deletes the object and then the row.
      //
      // Counting rows demanded the queue be empty at the end of every run, which is
      // only true for accounts this suite just deleted. A row left by any earlier
      // run Ã¢â‚¬â€ including one interrupted mid-cleanup Ã¢â‚¬â€ kept failing every subsequent
      // run for a reason that had nothing to do with the code under test, and the
      // natural "fix" is to delete the row, which loses the only record that those
      // bytes still exist.
      //
      // So the assertion is about correctness rather than emptiness: any row whose
      // object is genuinely gone is a stale row, and any row whose object is still
      // in the bucket is real outstanding work. This run must leave neither kind.
      //
      // `bucketName` is resolved here rather than reused from later in this scope,
      // because this block runs in the pre-flight cleanup where it is not yet bound.
      const queueBucket = process.env.STORAGE_PROOFS_BUCKET || 'work-proofs';
      const { rows: quarantine } = await pool.query(
        'select id, bucket, path from public.orphaned_proof_media',
      );
      let staleQueueRows = 0;
      let stillQueued = 0;
      for (const row of quarantine) {
        const key = String(row.path).replace(new RegExp(`^${queueBucket}/`), '');
        const parts = key.split('/');
        const name = parts.pop();
        const { data: found } = await admin.storage.from(row.bucket || queueBucket).list(parts.join('/'), { limit: 1000 });
        if ((found ?? []).some((o) => o.name === name)) stillQueued += 1;
        else staleQueueRows += 1;
      }
      check(
        'every removal-queue row still points at an object that exists',
        stillQueued === 0,
        `${stillQueued} queued object(s) still in the bucket`,
      );
      if (staleQueueRows > 0) {
        // Reported, never repaired here, and deliberately not scored.
        //
        // A stale row is not a leak: `orphaned_proof_media` is a *work queue* written by
        // the account-deletion trigger when SQL cannot reach storage, and a row whose
        // object is gone means the removal already happened and the queue entry is a
        // completed record. Verified against the live database: 9 rows, 0 objects
        // present in the bucket, every uploader account deleted. The bytes are gone;
        // only the paperwork remains.
        //
        // Deleting the rows would be a database write against a record of somebody
        // else's account deletion, and it would destroy the only evidence that those
        // deletions completed — which is the one thing this table is for. It needs an
        // operator who has looked, not a test suite.
        //
        // The count is broken out so the note says which of the two situations it is:
        // "rows drained" is complete, "rows pending" is a real queue.
        const { rows: queueSummary } = await pool.query(
          `select count(*)::int as total,
                  count(*) filter (
                    where not exists (
                      select 1 from auth.users u where u.id::text = split_part(m.path, '/', 1)
                    )
                  )::int as uploader_gone
             from public.orphaned_proof_media m`,
        );
        const total = queueSummary[0]?.total ?? 0;
        const uploaderGone = queueSummary[0]?.uploader_gone ?? 0;
        console.log(
          `  NOTE  ${staleQueueRows} removal-queue row(s) refer to objects already deleted.`,
        );
        console.log(
          `        Queue: ${total} row(s) total, ${staleQueueRows} already drained, ${total - staleQueueRows} still pending.`,
        );
        console.log(
          `        ${uploaderGone}/${total} belong to accounts that no longer exist — the bytes are gone and the row is a completed record.`,
        );
        console.log('        Harmless to scoring. Draining them is an operator decision, not a test action.');
      }

      // Only this suite's own media may be gone. A blanket "the bucket is empty"
      // would fail the moment a single real worker has pending evidence, which is
      // the normal state of a live product Ã¢â‚¬â€ and worse, it would invite somebody to
      // "fix" it by deleting a real worker's photographs.
      //
      // The suite's uploads live under a `smoke.` account, and it records the exact
      // paths it created, so the question worth asking is whether any of *those*
      // remain. Anything else in the bucket belongs to somebody else.
      const bucketName = process.env.STORAGE_PROOFS_BUCKET || 'work-proofs';
      const { data: roots } = await admin.storage.from(bucketName).list('', { limit: 1000 });
      let foreignObjects = 0;
      for (const root of roots ?? []) {
        const isTestAccount = TEST_EMAIL_PREFIX.test(
          (await admin.auth.admin.getUserById(root.name).catch(() => null))?.data?.user?.email ?? '',
        );
        if (isTestAccount) {
          const { data: days } = await admin.storage.from(bucketName).list(root.name, { limit: 100 });
          for (const day of days ?? []) {
            const { data: objs } = await admin.storage
              .from(bucketName)
              .list(`${root.name}/${day.name}`, { limit: 100 });
            foreignObjects += (objs ?? []).length;
          }
        }
      }
      check(
        'no media of this suite\'s accounts left in the bucket',
        foreignObjects === 0,
        `${foreignObjects} object(s) under a smoke test account`,
      );
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
    // pointing at them Ã¢â‚¬â€ and the pre-flight has just destroyed the pointer. The rows
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

    // The training provider module's tables must exist before the suite drives it.
    //
    // Checked here, in pre-flight, rather than inferred from the section's own
    // results. Without it a run against a database where migration 0011 has not been
    // applied produces a wall of confusing 500s from the module's endpoints, and —
    // worse — the RLS assertions for those tables would pass, because a relation
    // that does not exist also returns an error and "the browser key got an error"
    // is indistinguishable from "the policy worked". A missing table has to read as
    // a missing table.
    for (const table of ['trainer_students', 'trainer_enrolment_codes', 'micro_credentials']) {
      const { rows: found } = await pool.query(`select to_regclass('public.${table}')::text as t`);
      check(
        `the training provider tables are present (public.${table})`,
        Boolean(found[0]?.t),
        found[0]?.t ?? 'absent — apply migration 0011_trainer_module',
      );
    }
    {
      // Schema-scoped, which the first version of this check was not.
      //
      // `pg_type` is cluster-wide, so an unscoped `typname` match is satisfied by a type
      // of the same name in *any* schema. That made the check weaker than it looked
      // rather than wrong: it reported the enum missing when a table genuinely existed
      // only if something else had shadowed the name, and it could not distinguish
      // "the type is absent" from "the type is somewhere unexpected". Scoping to
      // `public` — the schema the migration creates it in, and the one every other
      // check in this suite already uses via `to_regclass('public.…')` — makes the
      // answer mean what it says.
      const { rows: statusType } = await pool.query(
        `select exists (
            select 1
              from pg_type t
              join pg_namespace n on n.oid = t.typnamespace
             where t.typname = 'micro_credential_status'
               and n.nspname = 'public'
         ) as ok`,
      );
      check(
        'the micro_credential_status enum is present in public',
        statusType[0]?.ok === true,
        statusType[0]?.ok === true ? 'present in public' : 'absent - apply migration 0011_trainer_module',
      );

      // The enum having the right *values* is a separate question from its existing.
      // A migration that created the type with a `verified` or `issued` value would pass
      // the check above and break the design, so the values are asserted here.
      const { rows: statusValues } = await pool.query(
        `select array_agg(e.enumlabel order by e.enumsortorder)::text[] as values
           from pg_type t
           join pg_namespace n on n.oid = t.typnamespace
           join pg_enum e on e.enumtypid = t.oid
          where t.typname = 'micro_credential_status'
            and n.nspname = 'public'
          group by t.oid`,
      );
      const values = (statusValues[0]?.values ?? []).sort();
      check(
        'the enum carries exactly awaiting_student, accepted and declined',
        values.join(',') === 'accepted,awaiting_student,declined',
        values.join(',') || 'no values',
      );
      // The two values that would break the module's central guarantee. A credential
      // that could be `verified` by an institute, or `issued` without the student,
      // would undo the dual-backing design at the storage layer.
      check(
        'the enum has no "verified" or "issued" value',
        !values.includes('verified') && !values.includes('issued'),
        values.join(','),
      );
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
    if (!up) throw new Error(`the API did not become healthy on port ${API_PORT} (see the FAIL above for its last output)`);

    const health = await api('GET', '/health');
    check('health reports the database as up', health.json?.database === 'up', JSON.stringify(health.json));

    // The API's `helmet` set is not visible to typechecking and is easy to lose
    // in a middleware reorder, so it is asserted where the responses are already
    // being examined rather than trusted (doc/13 E-039).
    const apiHeaders = health.headers;
    const apiHeader = (name) => apiHeaders.get(name);
    check('API sets X-Content-Type-Options', apiHeader('x-content-type-options') === 'nosniff', apiHeader('x-content-type-options') ?? 'absent');
    check('API frames only itself', apiHeader('x-frame-options') !== null, apiHeader('x-frame-options') ?? 'absent');
    check('API suppresses the referrer', apiHeader('referrer-policy') === 'no-referrer', apiHeader('referrer-policy') ?? 'absent');
    check('API states transport security', apiHeader('strict-transport-security') !== null, apiHeader('strict-transport-security') ?? 'absent');
    check('API does not advertise the framework', apiHeader('x-powered-by') === null, apiHeader('x-powered-by') ?? 'absent');

    section('REGISTRATION');
    const email = `smoke.${Date.now()}@tetherproof.dev`;
    const password = 'SmokeTest123456';
    const reg = await api('POST', '/auth/register', {
      body: {
        email,
        password,
        role: 'worker',
        fullName: 'Smoke Test Worker',
        // A permitted return address must not change the outcome: this is the
        // field that decides where a confirmation link points, and a schema that
        // rejected it outright would break every registration from the web app.
        redirectOrigin: 'http://localhost:3210',
      },
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

    // An address this deployment never named must be refused rather than quietly
    // ignored. A confirmation link carries an access and refresh token on its way
    // to an inbox, so accepting any return address would turn every such link
    // into an open redirect that hands that session to whoever asked for it.
    const hostile = await api('POST', '/auth/register', {
      body: {
        email: `smoke.redirect.${Date.now()}@tetherproof.dev`,
        password,
        role: 'worker',
        redirectOrigin: 'https://attacker.example.net',
      },
    });
    check(
      'a confirmation link may not be pointed at an unlisted address',
      hostile.status === 400,
      `status ${hostile.status} ${hostile.text.slice(0, 140)}`,
    );
    check(
      'the refusal names the field at fault',
      hostile.json?.error?.details?.some((d) => d.path === 'redirectOrigin') === true,
      JSON.stringify(hostile.json?.error?.details),
    );
    check(
      'the refused registration created no account',
      hostile.json?.user == null,
      JSON.stringify(hostile.json?.user ?? null),
    );

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

    // Declared outside the engine block because the privacy check near the end of
    // the run reads it after that block has closed. Declared *once*, here: an
    // inner declaration of the same name shadows this one, which leaves the later
    // read looking at a variable nothing ever assigns Ã¢â‚¬â€ the state in which a
    // security assertion passes no matter what the code under test does.
    let offsiteRow = null;

    if (userId && token) {
      // A phone number used nowhere else in the run, so its hash is unique to
      // this verifier and the history below belongs to it alone.
      const RING_PHONE = '+233550000001';
      const ACCRA = '5.6037,-0.1870';
      const LONDON = '51.5074,-0.1278';

      // `offsiteRow` is the outer declaration, assigned by the block below and read
      // again near the end of the run. It is deliberately not re-declared here.
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
                    (select verification_status from public.work_proof_logs where id=$1) as proof_status,
                    (select flag_reason from public.work_proof_logs where id=$1) as flag_reason,
                    (select flagged_at from public.work_proof_logs where id=$1) as flagged_at
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
        // Withheld, never accused. The engine has produced `flagged` Ã¢â‚¬â€ the record
        // does not count and a person will look at it Ã¢â‚¬â€ and `fraud_blocked` is now
        // reachable only through the admin review path, which no score can enter.
        check(
          'the proof is withheld from counting as verified',
          offsiteRow?.proof_status === 'flagged',
          String(offsiteRow?.proof_status),
        );
        check(
          'no scoring path can write fraud_blocked',
          offsiteRow?.proof_status !== 'fraud_blocked',
          String(offsiteRow?.proof_status),
        );
        check(
          'the worker is told the record was held, and that it is not a finding',
          typeof offsiteRow?.flag_reason === 'string' &&
            /not a finding of fraud/i.test(offsiteRow.flag_reason),
          String(offsiteRow?.flag_reason).slice(0, 120),
        );
        // `pg` returns a timestamptz as a Date, not a string; the assertion covers
        // either so it tests the value rather than the driver's representation.
        check(
          'the hold is timestamped so the worker can see when it happened',
          offsiteRow?.flagged_at !== null &&
            offsiteRow?.flagged_at !== undefined &&
            !Number.isNaN(new Date(offsiteRow.flagged_at).getTime()),
          String(offsiteRow?.flagged_at),
        );
        check(
          'the flag reason carries no score or threshold',
          !/\d\.\d+/.test(String(offsiteRow?.flag_reason ?? '')),
          String(offsiteRow?.flag_reason).slice(0, 90),
        );

        // The client is told what actually happened: they did confirm it, AND that
        // the record is not counting. Reporting only the first would let them
        // leave believing the work is now trusted proof.
        check(
          'the client is told their response was recorded as a confirmation',
          unwrap(offsiteConfirm.json)?.status === 'confirmed',
          JSON.stringify(offsiteConfirm.json).slice(0, 120),
        );
        check(
          'the client is also told the record is being held back',
          unwrap(offsiteConfirm.json)?.withheld === true,
          JSON.stringify(offsiteConfirm.json).slice(0, 160),
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

      // ------------------------------------------------------------------------
      // One decision per request: the supersede-on-replacement rule
      // ------------------------------------------------------------------------
      //
      // The work-logging form no longer collects a number, so every submission
      // lands with `dispatch_status = 'not_attempted'` and the link is shared by
      // hand. That makes "resend" a replacement rather than a redelivery, and the
      // rule that matters is that replacing a link must not leave two answerable
      // requests behind for one proof.
      //
      // The failure this guards against is concrete: an old token still hashes to a
      // live row with `response = 'none'`, so it would still accept a decision, and
      // whichever of the two answers landed last would win.
      const replacement = await submit('Replacement Path Check');
      check('a proof to replace was created', replacement !== null, replacement ? '' : 'refused');

      if (replacement) {
        const beforeResend = (
          await pool.query(
            `select count(*)::int as live from public.verifications
              where work_proof_id = $1 and response = 'none' and expires_at > now()`,
            [replacement.proofId],
          )
        ).rows[0]?.live;
        check('exactly one answerable request exists before the replacement', beforeResend === 1, String(beforeResend));

        // A live link can be replaced, because the worker holds no copy of it to
        // re-share: the API keeps only a hash of the token. Replacing must not
        // leave two answerable requests behind, and the superseded link must stop
        // working at once Ã¢â‚¬â€ a customer already holding it has to be turned away
        // rather than allowed a second, competing answer.
        const staleToken = replacement.verificationToken;
        const liveResend = await api(
          'POST',
          `/workers/proofs/${replacement.proofId}/verification/resend`,
          { token, body: {} },
        );
        check(
          'a live link can be replaced by its owner',
          liveResend.status === 200,
          String(liveResend.status),
        );

        const liveAfterRotation = (
          await pool.query(
            `select count(*)::int as live from public.verifications
              where work_proof_id = $1 and response = 'none' and expires_at > now()`,
            [replacement.proofId],
          )
        ).rows[0]?.live;
        check(
          'replacing a live link still leaves exactly one answerable request',
          liveAfterRotation === 1,
          `${liveAfterRotation} live after rotation`,
        );

        // The link that was already handed out must be dead the moment the
        // replacement exists, not merely deprioritised.
        const oldLinkAfterRotation = await api(
          'POST',
          `/verifications/${staleToken}`,
          { body: { response: 'confirmed' } },
        );
        check(
          'the link that was replaced no longer accepts an answer',
          oldLinkAfterRotation.status === 410 || oldLinkAfterRotation.status === 409,
          String(oldLinkAfterRotation.status),
        );

        // Age the existing request so the replacement is legitimate, then replace it.
        await pool.query(
          `update public.verifications set expires_at = now() - interval '1 minute'
            where work_proof_id = $1 and response = 'none'`,
          [replacement.proofId],
        );

        const resend = await api('POST', `/workers/proofs/${replacement.proofId}/verification/resend`, {
          token,
          body: {},
        });
        const resendBody = resend.status === 200 ? unwrap(resend.json) : null;
        check('an expired request can be replaced', resendBody !== null, String(resend.status));

        if (resendBody) {
          const liveAfter = (
            await pool.query(
              `select count(*)::int as live from public.verifications
                where work_proof_id = $1 and response = 'none' and expires_at > now()`,
              [replacement.proofId],
            )
          ).rows[0]?.live;
          check(
            'replacement leaves exactly one answerable request',
            liveAfter === 1,
            `${liveAfter} live after replacement`,
          );

          // The retired token must not still be able to decide anything. This is
          // the assertion the whole supersede step exists for.
          const staleAnswer = await api('POST', `/verifications/${replacement.verificationToken}`, {
            body: { response: 'confirmed' },
          });
          check(
            'the superseded token can no longer record a decision',
            staleAnswer.status === 410 || staleAnswer.status === 409,
            String(staleAnswer.status),
          );

          const freshAnswer = await api('POST', `/verifications/${resendBody.verificationToken}`, {
            body: { response: 'confirmed' },
          });
          check(
            'the replacement token still records the decision',
            freshAnswer.status === 200,
            String(freshAnswer.status),
          );

          // The recorded decision must survive everything that follows.
          const replay = await api('POST', `/verifications/${resendBody.verificationToken}`, {
            body: { response: 'rejected' },
          });
          check('a completed request cannot be decided again', replay.status === 409, String(replay.status));

          const finalStatus = (
            await pool.query('select verification_status from public.work_proof_logs where id = $1', [
              replacement.proofId,
            ])
          ).rows[0]?.verification_status;
          check(
            'the replayed rejection did not overwrite the confirmation',
            finalStatus === 'verified' || finalStatus === 'fraud_blocked',
            String(finalStatus),
          );

          const postResend = await api('POST', `/workers/proofs/${replacement.proofId}/verification/resend`, {
            token,
            body: {},
          });
          check(
            'a concluded log cannot receive a replacement request',
            postResend.status === 409,
            String(postResend.status),
          );
        }
      }

      // The freeze rule follows the link, not a delivery. With no number collected
      // the dispatch never runs, so a rule keyed on delivery would never fire.
      const frozen = await api('PATCH', `/workers/proofs/${offsite?.proofId ?? ringProofs[0]}`, {
        token,
        body: { description: 'A description edited after the link went out.' },
      });
      check(
        'a log with a live link cannot be edited',
        frozen.status === 409,
        String(frozen.status),
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

      // A fresh, still-answerable proof, used only to read the summary a recipient
      // sees. It is left unanswered so the link stays live for the read.
      const summaryProof = await submit('Summary Disclosure Check');
      check('a proof to read the summary from was created', summaryProof !== null, summaryProof ? '' : 'refused');

      // The verification page now shows the recipient the evidence, so the summary
      // must carry a usable signed URL Ã¢â‚¬â€ and must still withhold everything a link
      // holder is not entitled to. Read with no session at all: the route is public
      // by design and the token is the only credential, which is exactly the
      // property the recipient page depends on.
      const summaryProbe = await api('GET', `/verifications/${summaryProof?.verificationToken ?? ''}`);
      check(
        'the verification summary is served to a link holder with no account',
        summaryProbe.status === 200,
        String(summaryProbe.status),
      );

      if (summaryProbe.status === 200) {
        const body200 = unwrap(summaryProbe.json);

        check(
          'the summary carries the evidence the recipient needs',
          typeof body200.mediaUrl === 'string' && body200.mediaUrl.startsWith('http'),
          typeof body200.mediaUrl,
        );
        check(
          'the evidence is a signed URL, never a bare storage path',
          typeof body200.mediaUrl === 'string' &&
            /token=/.test(body200.mediaUrl) &&
            !body200.mediaUrl.includes('/object/public/'),
        );
        check('the summary states when the work was logged', typeof body200.loggedAt === 'string');
        check(
          'the summary states the skill level claimed',
          body200.skillLevel === null || typeof body200.skillLevel === 'number',
          String(body200.skillLevel),
        );

        // The privacy boundary, checked on the real response body rather than on
        // the shape of the code that builds it.
        // The worker is now named on the page, when they have allowed it, so the
        // customer can tell who they are answering. What must never appear is the
        // worker's id Ã¢â‚¬â€ a link is forwardable, and an id would be something a
        // reader could act on rather than merely read.
        check(
          'the summary names the worker when they allow it',
          typeof body200.workerName === 'string' && body200.workerName.length > 0,
          String(body200.workerName),
        );
        check('the summary still carries no worker id', !('workerId' in body200));
        check('the summary exposes no GPS telemetry', !('submissionGps' in body200));
        check('the summary exposes no fraud score', !('fraudScore' in body200));
        check('the summary exposes no verifier number', !JSON.stringify(body200).includes('verifierPhone'));
        check('the summary exposes no storage bucket path', !('mediaPath' in body200));

        // The signed URL must actually resolve, or the one person whose judgement
        // the record depends on is shown a broken image.
        const fetched = await fetch(body200.mediaUrl);
        check('the signed evidence URL resolves to the file', fetched.status === 200, String(fetched.status));

        // The opt-out has to actually withhold. A switch that is stored and then
        // ignored is worse than no switch, because it promises something it does
        // not do. Toggled here, read back through the same endpoint, and put back.
        const optedOut = await api('PATCH', '/auth/profile', {
          token,
          body: { showNameOnVerificationLink: false },
        });
        check(
          'the worker can turn their name off for verification links',
          optedOut.status === 200 && optedOut.json?.showNameOnVerificationLink === false,
          JSON.stringify(optedOut.json).slice(0, 160),
        );

        const anonymous = await api('GET', `/verifications/${rawToken}`);
        check(
          'the verification page names nobody once the worker has opted out',
          anonymous.json?.workerName === null && anonymous.json?.workerAvatarUrl === null,
          JSON.stringify({ n: anonymous.json?.workerName, a: anonymous.json?.workerAvatarUrl }),
        );
        check(
          'the work itself is still shown to the customer',
          typeof anonymous.json?.taskSummary === 'string' && anonymous.json.taskSummary.length > 0,
          'the work summary disappeared with the name',
        );

        const optedBackIn = await api('PATCH', '/auth/profile', {
          token,
          body: { showNameOnVerificationLink: true },
        });
        check(
          'the worker can turn it back on',
          optedBackIn.status === 200 && optedBackIn.json?.showNameOnVerificationLink === true,
          JSON.stringify(optedBackIn.json).slice(0, 160),
        );
      }

      // A decision recorded with no session at all, and still final.
      // Two taps on one token, deliberately simultaneous.
      //
      // This both proves an accountless decision works and proves the single-
      // decision rule is closed against a *race*, not merely against a sequential
      // replay Ã¢â‚¬â€ which is the part a read-then-write implementation would get
      // wrong. It replaces a single confirmation rather than adding requests,
      // because the suite already sits at the edge of the 30-per-minute
      // verification limiter and the 20-per-15-minutes upload limiter, and
      // neither control should be tuned for the sake of a test.
      const [confirmRes, rejectRes] = await Promise.all([
        api('POST', `/verifications/${summaryProof?.verificationToken ?? ''}`, { body: { response: 'confirmed' } }),
        api('POST', `/verifications/${summaryProof?.verificationToken ?? ''}`, { body: { response: 'rejected' } }),
      ]);
      const raced = [confirmRes.status, rejectRes.status].sort();
      check(
        'two simultaneous decisions produce exactly one winner',
        raced[0] === 200 && raced[1] === 409,
        raced.join(' and '),
      );

      const storedDecision = (
        await pool.query('select response from public.verifications where work_proof_id = $1', [
          summaryProof?.proofId ?? '00000000-0000-0000-0000-000000000000',
        ])
      ).rows[0]?.response;
      check(
        'exactly one response is recorded',
        ['confirmed', 'rejected'].includes(storedDecision),
        String(storedDecision),
      );

      const anonStatus = (
        await pool.query('select verification_status from public.work_proof_logs where id = $1', [
          summaryProof?.proofId ?? '00000000-0000-0000-0000-000000000000',
        ])
      ).rows[0]?.verification_status;
      check(
        'the proof status matches the single recorded decision',
        storedDecision === 'rejected'
          ? anonStatus === 'rejected'
          : anonStatus === 'verified' || anonStatus === 'fraud_blocked',
        `${storedDecision} -> ${anonStatus}`,
      );
      check(
        'the winning decision was recorded by an accountless caller',
        raced[0] === 200,
        `winner ${raced[0]}`,
      );

      const anonReplay = await api('POST', `/verifications/${summaryProof?.verificationToken ?? ''}`, {
        body: { response: 'rejected' },
      });
      check('an accountless confirmation cannot be replayed', anonReplay.status === 409, String(anonReplay.status));

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

        // A name and a photo are now carried, because a worker who is `discoverable`
        // has said they may be found and an employer cannot otherwise tell two
        // otherwise-identical candidates apart. Contact details are still withheld:
        // those belong to an accepted invitation, not to a search.
        check(
          'the card carries the worker name for a discoverable worker',
          typeof card?.displayName === 'string' && card.displayName.length > 0,
          String(card?.displayName),
        );
        check(
          'the card does not leak a phone number or an email',
          !/phone|email/i.test(cardJson),
          cardJson.slice(0, 200),
        );

        // --- Search matching --------------------------------------------
        // Case-insensitive and partial. An employer typing one meaningful word, or
        // the wrong capitalisation, has to reach the same worker they would by
        // reproducing their wording exactly.
        for (const [label, query] of [
          ['a single meaningful word', 'solar'],
          ['the same word in lower case', 'SOLAR'],
          ['a later word in the name', 'installation'],
          ['two words in the wrong order', 'panel solar'],
          ['a leading substring', 'solar panel'],
        ]) {
          const partial = await api(
            'GET',
            `/employers/search?requiredSkill=${encodeURIComponent(query)}&minProofThreshold=1`,
            { token: employer.token },
          );
          check(
            `searching by ${label} finds the worker`,
            partial.status === 200 && (partial.json?.candidates ?? []).length >= 1,
            `"${query}" -> status ${partial.status} ${(partial.json?.candidates ?? []).length} candidates`,
          );
        }

        // Broad, but still narrow. A word nobody uses as a skill must not return the
        // network, and punctuation-only input must not match everything either.
        for (const [label, query] of [
          ['a word that is not a skill', 'zzzznotaskill'],
          ['punctuation only', '---'],
        ]) {
          const broad = await api(
            'GET',
            `/employers/search?requiredSkill=${encodeURIComponent(query)}&minProofThreshold=1`,
            { token: employer.token },
          );
          check(
            `${label} returns nothing rather than everything`,
            broad.status === 200 && (broad.json?.candidates ?? []).length === 0,
            `"${query}" -> ${(broad.json?.candidates ?? []).length} candidates`,
          );
        }

        // The proof floor still applies to a partial match: broadening the wording
        // must not bypass the requirement that a worker actually has verified proof.
        const partialTooTight = await api(
          'GET',
          `/employers/search?requiredSkill=solar&minProofThreshold=99`,
          { token: employer.token },
        );
        check(
          'a partial match still honours the proof threshold',
          partialTooTight.status === 200 && (partialTooTight.json?.candidates ?? []).length === 0,
          `${(partialTooTight.json?.candidates ?? []).length} candidates`,
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

        // --- Saved workers --------------------------------------------
        // The employer keeps a candidate between searches. Driven entirely through
        // the API against the real table, because the properties worth testing here
        // are all about what one employer can and cannot reach: the saved list is
        // scoped, saving is addressed by handle rather than by worker id, and a
        // worker who opts out stops being reachable through it.
        const savedCandidate = card;

        const savedBefore = await api('GET', '/employers/saved-workers', { token: employer.token });
        check(
          'the saved-worker list starts empty for this employer',
          savedBefore.status === 200 && (savedBefore.json?.workers ?? []).length === 0,
          `status ${savedBefore.status} ${(savedBefore.json?.workers ?? []).length} worker(s)`,
        );

        const saved = await api('POST', '/employers/saved-workers', {
          token: employer.token,
          body: { candidateHandle: savedCandidate.candidateHandle, skillTag: MATCH_SKILL },
        });
        check(
          'a candidate from a search result can be saved',
          saved.status === 201 && typeof saved.json?.savedId === 'string',
          `status ${saved.status} ${saved.text.slice(0, 140)}`,
        );

        // Re-saving the same worker under the same skill must be one row, not two.
        // A double tap is not a second intention.
        const resave = await api('POST', '/employers/saved-workers', {
          token: employer.token,
          body: { candidateHandle: savedCandidate.candidateHandle, skillTag: MATCH_SKILL },
        });
        check(
          'saving the same worker twice is accepted and stays one entry',
          resave.status === 201 && resave.json?.savedId === saved.json?.savedId,
          `status ${resave.status} ${resave.json?.savedId} vs ${saved.json?.savedId}`,
        );

        const savedAfter = await api('GET', '/employers/saved-workers', { token: employer.token });
        const savedRows = savedAfter.json?.workers ?? [];
        check(
          'the saved list reports exactly one worker after two saves',
          savedAfter.status === 200 && savedRows.length === 1,
          `status ${savedAfter.status} ${savedRows.length} worker(s)`,
        );

        const savedRow = savedRows[0];
        check(
          'the saved entry carries a fresh candidate handle',
          typeof savedRow?.candidateHandle === 'string' && savedRow.candidateHandle.length >= 32,
          String(savedRow?.candidateHandle)?.slice(0, 12),
        );
        check(
          'the saved entry reports the real verified-proof count, not a placeholder',
          savedRow?.verifiedProofs === 2,
          `${savedRow?.verifiedProofs} Ã¢â‚¬â€ a saved list showing 0 would read as no verified proof`,
        );
        check(
          'the saved entry names the worker',
          typeof savedRow?.displayName === 'string' && savedRow.displayName.length > 0,
          String(savedRow?.displayName),
        );
        check(
          'the saved entry records when it was saved',
          typeof savedRow?.savedAt === 'string' && !Number.isNaN(Date.parse(savedRow.savedAt)),
          String(savedRow?.savedAt),
        );

        // The masking must survive the saved list: it is the same contract as a
        // search card, so the same assertions apply.
        const savedJson = JSON.stringify(savedAfter.json);
        check('the saved list contains no worker id', !savedJson.includes(userId), userId ?? '');
        check(
          'the saved list contains no email address',
          !savedJson.includes('tetherproof.dev'),
          '',
        );
        check(
          'the saved list exposes no phone number',
          !/phone/i.test(savedJson),
          savedJson.slice(0, 200),
        );

        // --- Isolation between employers -----------------------------
        const peekerList = await api('GET', '/employers/saved-workers', { token: peeker.token });
        check(
          'another employer cannot see the saved entry',
          peekerList.status === 200 && (peekerList.json?.workers ?? []).length === 0,
          `${(peekerList.json?.workers ?? []).length} worker(s) visible`,
        );

        // A handle from another employer's search is not resolvable here. The
        // service resolves it scoped to the caller, so this must be refused rather
        // than silently saving the wrong worker.
        const foreignSave = await api('POST', '/employers/saved-workers', {
          token: peeker.token,
          body: { candidateHandle: savedCandidate.candidateHandle, skillTag: MATCH_SKILL },
        });
        check(
          "an employer cannot save a candidate using another employer's handle",
          foreignSave.status === 404,
          `status ${foreignSave.status} ${foreignSave.text.slice(0, 120)}`,
        );

        // Manipulated handles must not resolve, and must not leak whether a worker
        // exists on the other side of them.
        for (const [label, handle] of [
          ['an empty handle', ''],
          ['a short handle', 'abc'],
          ['a well-formed but unknown handle', 'z'.repeat(48)],
        ]) {
          const attempt = await api('POST', '/employers/saved-workers', {
            token: employer.token,
            body: { candidateHandle: handle, skillTag: MATCH_SKILL },
          });
          const refused = attempt.status === 400 || attempt.status === 404;
          check(`${label} is refused`, refused, `status ${attempt.status}`);
        }

        // A saved id belonging to another employer must change nothing, and must be
        // indistinguishable from one that never existed.
        const foreignRemove = await api(
          'DELETE',
          `/employers/saved-workers/${saved.json.savedId}`,
          { token: peeker.token },
        );
        check(
          "another employer cannot remove a saved worker they do not own",
          foreignRemove.status === 204,
          `status ${foreignRemove.status}`,
        );
        const stillThere = await api('GET', '/employers/saved-workers', { token: employer.token });
        check(
          'the entry survives the removal attempt',
          (stillThere.json?.workers ?? []).length === 1,
          `${(stillThere.json?.workers ?? []).length} worker(s)`,
        );

        // No `body` on a GET: the helper would attach one, and a body on a GET is
        // refused before it reaches a route.
        const anonList = await api('GET', '/employers/saved-workers');
        check('the saved list requires a session', anonList.status === 401, `status ${anonList.status}`);

        const anonSave = await api('POST', '/employers/saved-workers', {
          body: { candidateHandle: savedCandidate.candidateHandle, skillTag: MATCH_SKILL },
        });
        check('saving a worker requires a session', anonSave.status === 401, `status ${anonSave.status}`);

        // A worker is not an employer. The route is mounted employer-only, so this
        // is refused at the boundary rather than by a row count happening to be zero.
        const workerSaved = await api('POST', '/employers/saved-workers', {
          token,
          body: { candidateHandle: savedCandidate.candidateHandle, skillTag: MATCH_SKILL },
        });
        check(
          'a worker cannot use the employer saved-worker endpoint',
          workerSaved.status === 403,
          `status ${workerSaved.status}`,
        );

        // --- Discovery opt-out ----------------------------------------
        // The point of re-gating on read: a worker who opts out after being saved
        // must stop being reachable through the list, not merely stop being found.
        const optedOut = await api('PATCH', '/auth/profile', {
          token,
          body: { discoverable: false },
        });
        check(
          'the worker can opt out of discovery',
          optedOut.status === 200 && optedOut.json?.discoverable === false,
          `status ${optedOut.status}`,
        );

        const afterOptOut = await api('GET', '/employers/saved-workers', { token: employer.token });
        check(
          'an opted-out worker disappears from the saved list',
          afterOptOut.status === 200 && (afterOptOut.json?.workers ?? []).length === 0,
          `${(afterOptOut.json?.workers ?? []).length} worker(s) still listed`,
        );
        check(
          'the saved list names nobody once the worker has opted out',
          !String(afterOptOut.text ?? '').includes('Smoke Test Worker'),
          afterOptOut.text.slice(0, 160),
        );

        // The search card carries the saved state, so a star on a result reflects
        // what is stored rather than resetting on reload. Asserted while opted out
        // would be meaningless, so this runs after opting back in.
        const optedBackIn = await api('PATCH', '/auth/profile', {
          token,
          body: { discoverable: true },
        });
        check(
          'the worker can opt back in',
          optedBackIn.status === 200 && optedBackIn.json?.discoverable === true,
          `status ${optedBackIn.status}`,
        );

        const searchAfterSave = await api(
          'GET',
          `/employers/search?requiredSkill=${encodeURIComponent(MATCH_SKILL)}&minProofThreshold=2`,
          { token: employer.token },
        );
        const searchCardNow = (searchAfterSave.json?.candidates ?? [])[0];
        check(
          'the search card reports the saved entry so the star survives a reload',
          searchCardNow?.savedId === saved.json.savedId,
          `card ${searchCardNow?.savedId} vs saved ${saved.json.savedId}`,
        );

        // --- Removal --------------------------------------------------
        const removed = await api('DELETE', `/employers/saved-workers/${saved.json.savedId}`, {
          token: employer.token,
        });
        check('the owner can remove a saved worker', removed.status === 204, `status ${removed.status}`);

        const afterRemove = await api('GET', '/employers/saved-workers', { token: employer.token });
        check(
          'the saved list is empty again after removal',
          afterRemove.status === 200 && (afterRemove.json?.workers ?? []).length === 0,
          `${(afterRemove.json?.workers ?? []).length} worker(s)`,
        );

        const removedTwice = await api('DELETE', `/employers/saved-workers/${saved.json.savedId}`, {
          token: employer.token,
        });
        // Idempotent, and deliberately so. A removal that reported "no such entry"
        // the second time would confirm the id had once existed, which is exactly
        // the oracle the cross-employer refusal above exists to prevent. Asserted
        // here as the property it is, rather than as the failure I first expected.
        check(
          'removing an already-removed entry succeeds rather than confirming it existed',
          removedTwice.status === 204,
          `status ${removedTwice.status}`,
        );

        // The anti-oracle property, stated directly: an id that never existed and
        // one that existed and was removed are answered identically.
        const neverExisted = '3f1c9d2e-8b47-4a61-9c05-77e1d4b28a10';
        const removeGhost = await api('DELETE', `/employers/saved-workers/${neverExisted}`, {
          token: employer.token,
        });
        const removeReal = await api('DELETE', `/employers/saved-workers/${saved.json.savedId}`, {
          token: employer.token,
        });
        check(
          'removing an id that never existed is answered exactly like removing a real one',
          removeGhost.status === removeReal.status,
          `ghost ${removeGhost.status} vs real ${removeReal.status}`,
        );

        const afterIdempotent = await api('GET', '/employers/saved-workers', { token: employer.token });
        check(
          'the repeated removals changed nothing',
          (afterIdempotent.json?.workers ?? []).length === 0,
          `${(afterIdempotent.json?.workers ?? []).length} worker(s)`,
        );

        const badId = await api('DELETE', '/employers/saved-workers/not-a-uuid', {
          token: employer.token,
        });
        check('a malformed saved id is refused', badId.status === 400, `status ${badId.status}`);

        // The row is actually gone from the table, not merely hidden from the list.
        const rowsLeft = (
          await pool.query(
            `select count(*)::int as n from public.employer_saved_workers
              where employer_id = (select u.id from public.users u join auth.users a on a.id = u.id where a.email = $1)`,
            [employerEmail],
          )
        ).rows[0]?.n;
        check(
          'no saved-worker row survives the removal',
          rowsLeft === 0,
          `${rowsLeft} row(s) left in the table`,
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

      // ---------------------------------------------------------------------
      // Phase 4b. The training provider module, driven against the live API.
      //
      // Two institutes and one student, because the two questions this section has
      // to answer are "does the flow work" and "can one institute see or act on
      // another's". A single institute would pass the first and silently fail the
      // second, which is the failure that matters most here.
      section('TRAINING PROVIDER MODULE');

      const trainer = await mintAccount(`smoke.${stamp}.trainer@tetherproof.dev`, 'training_provider', 'Smoke Test Institute');
      const rivalTrainer = await mintAccount(`smoke.${stamp}.rival-trainer@tetherproof.dev`, 'training_provider', 'Smoke Rival Institute');
      const studentWorker = await mintAccount(`smoke.${stamp}.student@tetherproof.dev`, 'worker', 'Smoke Test Student');

      check('a provisioned training provider account can be used', Boolean(trainer.token), trainer.error ?? 'no token');
      check('a second training provider account can be used', Boolean(rivalTrainer.token), rivalTrainer.error ?? 'no token');
      check('a student worker account can be used', Boolean(studentWorker.token), studentWorker.error ?? 'no token');

      // Role gates. Asserted at the mount, so a wrong role is a 403 on every route
      // in the group rather than a 403 on whichever handler happened to check.
      if (trainer.token) {
        const anonOverview = await api('GET', '/trainers/overview');
        check('the trainer dashboard refuses an unauthenticated caller', anonOverview.status === 401, `status ${anonOverview.status}`);

        if (employer.token) {
          const asEmployer = await api('GET', '/trainers/overview', { token: employer.token });
          check('an employer cannot reach training provider tools', asEmployer.status === 403, `status ${asEmployer.status}`);
        }
        if (userId && token) {
          const asWorker = await api('GET', '/trainers/overview', { token });
          check('a worker cannot reach training provider tools', asWorker.status === 403, `status ${asWorker.status}`);
        }
      }
      if (employer.token) {
        const employerRoster = await api('GET', '/trainers/roster', { token: employer.token });
        check('an employer cannot read any roster', employerRoster.status === 403, `status ${employerRoster.status}`);
      }
      if (studentWorker.token) {
        const studentRoster = await api('GET', '/trainers/roster', { token: studentWorker.token });
        check('a student cannot read an institute roster', studentRoster.status === 403, `status ${studentRoster.status}`);

        const studentIssuing = await api('POST', '/trainers/credentials', {
          token: studentWorker.token,
          body: { enrolmentId: '00000000-0000-0000-0000-000000000000', skillTag: 'Welding', milestoneTitle: 'Forge practical' },
        });
        check('a student cannot issue a milestone', studentIssuing.status === 403, `status ${studentIssuing.status}`);
      }

      // Enrolment. A code is issued, shown once, and is not readable again.
      let enrolmentCode = null;
      if (trainer.token) {
        const emptyRoster = await api('GET', '/trainers/roster', { token: trainer.token });
        check('a new institute starts with an empty roster', emptyRoster.status === 200 && emptyRoster.json?.students?.length === 0, `status ${emptyRoster.status} ${emptyRoster.json?.students?.length} students`);
        check('a new institute has no active enrolment code', emptyRoster.json?.hasActiveCode === false, `hasActiveCode ${emptyRoster.json?.hasActiveCode}`);

        const codeResponse = await api('POST', '/trainers/roster/code', { token: trainer.token });
        check('an enrolment code can be created', codeResponse.status === 201, `status ${codeResponse.status}`);
        enrolmentCode = codeResponse.json?.enrolmentCode ?? null;
        check('the enrolment code is returned once, in a copyable form', typeof enrolmentCode === 'string' && /^[A-Z2-9]{12}$/.test(enrolmentCode), String(enrolmentCode));
      }

      // The raw code exists only in the creation response. A read of the roster
      // exposes no code field at all, which is the structural half of the guarantee
      // — the digest is stored, so there is nothing to read back.
      if (trainer.token) {
        const afterCode = await api('GET', '/trainers/roster', { token: trainer.token });
        check('the roster reports the code exists but never returns it', afterCode.json?.hasActiveCode === true && afterCode.json?.enrolmentCode === undefined, `hasActiveCode ${afterCode.json?.hasActiveCode}, code field ${String(afterCode.json?.enrolmentCode)}`);
      }

      if (studentWorker.token) {
        const badCode = await api('POST', '/workers/enrolment', { token: studentWorker.token, body: { code: 'ZZZZZZZZZZZZ' } });
        check('an unknown enrolment code is refused', badCode.status === 400, `status ${badCode.status}`);

        const emptyCode = await api('POST', '/workers/enrolment', { token: studentWorker.token, body: { code: '' } });
        check('an empty enrolment code is refused', emptyCode.status === 400, `status ${emptyCode.status}`);

        if (enrolmentCode) {
          const redeemed = await api('POST', '/workers/enrolment', { token: studentWorker.token, body: { code: enrolmentCode } });
          check('a student can redeem an enrolment code', redeemed.status === 200 && redeemed.json?.enrolled === true, `status ${redeemed.status}`);

          // Redeeming twice must not create a second roster entry. The unique index
          // is what makes this true, and the assertion is on the count rather than
          // on the status, because a second row would be invisible to the caller.
          const twice = await api('POST', '/workers/enrolment', { token: studentWorker.token, body: { code: enrolmentCode } });
          check('redeeming the same code twice is idempotent', twice.status === 200, `status ${twice.status}`);
        }
      }

      let enrolmentId = null;
      if (trainer.token) {
        const roster = await api('GET', '/trainers/roster', { token: trainer.token });
        check('the redeemed student appears on the roster', roster.json?.students?.length === 1, `${roster.json?.students?.length} students`);
        enrolmentId = roster.json?.students?.[0]?.enrolmentId ?? null;

        // The roster carries a name and nothing else. No email, phone, or location
        // may appear, in any field, under any name.
        const rosterBlob = JSON.stringify(roster.json);
        check('the roster exposes no email address', !rosterBlob.includes('@'), 'roster payload contained an address');
        check('the roster exposes no location', !/"(locationGps|location_gps|coordinates|latitude|longitude)"/i.test(rosterBlob), 'roster payload contained a location');
      }

      // Cross-institute isolation. The rival institute shares no relationship with
      // this student, so every route must behave as though the enrolment does not
      // exist — and must say so with a 404 rather than a 403, because a 403 would
      // confirm that somebody else's enrolment id is real.
      if (rivalTrainer.token && enrolmentId) {
        const rivalRoster = await api('GET', '/trainers/roster', { token: rivalTrainer.token });
        check("a rival institute does not see another institute's roster", rivalRoster.json?.students?.length === 0, `${rivalRoster.json?.students?.length} students`);

        const rivalIssue = await api('POST', '/trainers/credentials', {
          token: rivalTrainer.token,
          body: { enrolmentId, skillTag: 'Welding', milestoneTitle: 'Rival practical' },
        });
        check("a rival institute cannot issue against another institute's enrolment", rivalIssue.status === 404, `status ${rivalIssue.status}`);

        const rivalRemove = await api('DELETE', `/trainers/roster/${enrolmentId}`, { token: rivalTrainer.token });
        check("a rival institute cannot remove another institute's student", rivalRemove.status === 404, `status ${rivalRemove.status}`);

        const rivalList = await api('GET', '/trainers/credentials', { token: rivalTrainer.token });
        check("a rival institute sees none of another institute's credentials", rivalList.json?.credentials?.length === 0, `${rivalList.json?.credentials?.length} credentials`);
      }

      // The milestone issuer. Validation first, then the happy path.
      if (trainer.token && enrolmentId) {
        const unknownStudent = await api('POST', '/trainers/credentials', {
          token: trainer.token,
          body: { enrolmentId: '00000000-0000-0000-0000-000000000000', skillTag: 'Welding', milestoneTitle: 'Nowhere practical' },
        });
        check('a milestone cannot be issued to somebody not on the roster', unknownStudent.status === 404, `status ${unknownStudent.status}`);

        const badEnrolment = await api('POST', '/trainers/credentials', {
          token: trainer.token,
          body: { enrolmentId: 'not-a-uuid', skillTag: 'Welding', milestoneTitle: 'Bad practical' },
        });
        check('a malformed enrolment id is refused', badEnrolment.status === 400, `status ${badEnrolment.status}`);

        const noSkill = await api('POST', '/trainers/credentials', {
          token: trainer.token,
          body: { enrolmentId, milestoneTitle: 'No skill practical' },
        });
        check('a milestone with no skill is refused', noSkill.status === 400, `status ${noSkill.status}`);

        const noTitle = await api('POST', '/trainers/credentials', {
          token: trainer.token,
          body: { enrolmentId, skillTag: 'Welding' },
        });
        check('a milestone with no practical name is refused', noTitle.status === 400, `status ${noTitle.status}`);

        const badLevel = await api('POST', '/trainers/credentials', {
          token: trainer.token,
          body: { enrolmentId, skillTag: 'Welding', milestoneTitle: 'Level practical', skillLevel: 9 },
        });
        check('a skill level outside 1 to 3 is refused', badLevel.status === 400, `status ${badLevel.status}`);
      }

      let credentialId = null;
      if (trainer.token && enrolmentId) {
        const issued = await api('POST', '/trainers/credentials', {
          token: trainer.token,
          body: { enrolmentId, skillTag: 'Forge Welding', milestoneTitle: 'Forge welding practical 3', skillLevel: 2, note: 'Passed the practical.' },
        });
        check('a milestone can be signed off for a roster student', issued.status === 201, `status ${issued.status}`);
        credentialId = issued.json?.id ?? null;

        // The whole design in one assertion: signing off produces a credential
        // *awaiting the student*. If this ever read anything else, an institute
        // could attach an endorsement to a student's record without them.
        check('a signed-off milestone is awaiting the student, not already a credential', issued.json?.status === 'awaiting_student', `status ${String(issued.json?.status)}`);
        check('a signed-off milestone is never reported as answered', issued.json?.answeredAt === null, String(issued.json?.answeredAt));
      }

      // The student is told, which is the only route by which they can learn a
      // credential is waiting. Without it the credential would sit unanswered for
      // ever and never count for anything.
      if (studentWorker.token) {
        const waiting = await api('GET', '/workers/credentials', { token: studentWorker.token });
        check('the student can see a milestone waiting for them', waiting.json?.awaiting?.length === 1, `${waiting.json?.awaiting?.length} awaiting`);

        const holder = waiting.json?.awaiting?.[0] ?? {};
        check('the student is shown the practical and the skill', Boolean(holder.milestoneTitle && holder.skillTag), `${String(holder.milestoneTitle)} / ${String(holder.skillTag)}`);

        // Attribution is the point: an endorsement with nobody's name on it is the kind
        // of claim this platform exists to make attributable. These two are the checks
        // that failed against the migrated database, because the API read
        // `profiles.organization_name` and `profiles.full_name` directly and this
        // fixture is provisioned through the service role, which never creates a
        // `profiles` row. The API now resolves both through a fallback chain ending in
        // the issuing account's own name; these assert the chain is still in place.
        check(
          'the credential names the institute that issued it',
          typeof holder.organizationName === 'string' && holder.organizationName.trim().length > 0,
          `organizationName ${JSON.stringify(holder.organizationName)}`,
        );
        check(
          'the credential names the instructor who signed it off',
          typeof holder.instructorName === 'string' && holder.instructorName.trim().length > 0,
          `instructorName ${JSON.stringify(holder.instructorName)}`,
        );

        // The name must come from the issuing account, not be assembled from the
        // credential. A plausible-looking institution derived from the skill or the
        // milestone would be indistinguishable from a real one, so this pins that the
        // value is the account's name.
        const expectedIssuerName = 'Smoke Test Institute';
        check(
          'the issuer name is the issuing account name, not something derived from the credential',
          holder.organizationName === expectedIssuerName,
          `${JSON.stringify(holder.organizationName)} vs account ${JSON.stringify(expectedIssuerName)}`,
        );

        // And it is real stored data, not a string the response invented: the account
        // exists and its name is what came back.
        if (trainer.id) {
          const { rows: issuerRow } = await pool.query(
            `select u.role, a.raw_user_meta_data ->> 'full_name' as meta_name
               from public.users u join auth.users a on a.id = u.id
              where u.id = $1`,
            [trainer.id],
          );
          check(
            'the credential names an account that really exists with the training provider role',
            issuerRow[0]?.role === 'training_provider',
            `role ${String(issuerRow[0]?.role)}`,
          );
        }

        // Attribution must never leak somebody else's identity. The issuer is named;
        // no other account's name may appear anywhere in the payload.
        const studentBlob2 = JSON.stringify(waiting.json);
        check(
          'the credential names no account other than the issuer',
          !studentBlob2.includes(rivalTrainer.id) && !studentBlob2.includes(trainer.id),
          'a non-issuer id appeared in the payload',
        );

        const studentBlob = JSON.stringify(waiting.json);
        check("the student's credential view carries no email address", !studentBlob.includes('@'), 'payload contained an address');
      }

      // The second signature. Until the student answers, nothing is held.
      if (studentWorker.token) {
        const badResponse = await api('POST', `/workers/credentials/${credentialId ?? '00000000-0000-0000-0000-000000000000'}`, { token: studentWorker.token, body: { response: 'verified' } });
        check('an answer other than accept or decline is refused', badResponse.status === 400, `status ${badResponse.status}`);
      }

      // A credential belonging to somebody else is a 404, not a 403: a 403 would
      // confirm the record exists.
      if (employer.token && credentialId) {
        const asEmployerAnswer = await api('POST', `/workers/credentials/${credentialId}`, { token: employer.token, body: { response: 'accepted' } });
        check("an employer cannot answer a worker's credential", asEmployerAnswer.status === 403, `status ${asEmployerAnswer.status}`);
      }

      if (rivalTrainer.token && credentialId) {
        const rivalAnswer = await api('POST', `/workers/credentials/${credentialId}`, { token: rivalTrainer.token, body: { response: 'accepted' } });
        check("a rival institute cannot answer another institute's credential", rivalAnswer.status === 403, `status ${rivalAnswer.status}`);
      }

      // Accepting must not touch the fraud-scored verified total. This is the single
      // most important assertion in the section: an institutional endorsement is not
      // work a customer confirmed, and a bootcamp that issued to a hundred students
      // must not make a hundred people look client-verified.
      //
      // Counted directly in the database rather than through an endpoint, because
      // the claim being tested is about rows that must never have been written. A
      // summary endpoint that quietly excluded them would pass while the rows
      // existed, and the exclusion is exactly the thing that needs checking.
      let studentProofRowsBefore = 0;
      let studentVerifiedProofsBefore = 0;
      if (studentWorker.token) {
        const { rows: proofRowsBefore } = await pool.query(
          `select count(*)::int n from public.work_proof_logs where worker_id = $1`,
          [studentWorker.id ?? '00000000-0000-0000-0000-000000000000'],
        );
        studentProofRowsBefore = proofRowsBefore[0].n;

        // The client-verified total for this student, from the same aggregation the
        // employer search uses. It is zero before and after accepting, which is the
        // property that stops a credential reading as verified work experience.
        const { rows: verifiedBeforeRows } = await pool.query(
          `select count(distinct p.id)::int n
             from public.work_proof_logs p
             left join public.verifications v
               on v.work_proof_id = p.id and v.response = 'confirmed'
            where p.worker_id = $1
              and exists (select 1 from public.verifications v2
                           where v2.work_proof_id = p.id and v2.response = 'confirmed')`,
          [studentWorker.id ?? '00000000-0000-0000-0000-000000000000'],
        );
        studentVerifiedProofsBefore = verifiedBeforeRows[0].n;
      }

      if (studentWorker.token && credentialId) {
        const accepted = await api('POST', `/workers/credentials/${credentialId}`, { token: studentWorker.token, body: { response: 'accepted' } });
        check('the student can accept a credential issued to them', accepted.status === 204, `status ${accepted.status}`);

        const stored = (
          await pool.query(`select status, answered_at from public.micro_credentials where id = $1`, [credentialId])
        ).rows[0];
        check('an accepted credential is stored as accepted, with a timestamp', stored?.status === 'accepted' && stored?.answered_at !== null, `status ${String(stored?.status)}`);

        // One answer, and it is final. A second tap must not silently rewrite a
        // decision the institute has already acted on.
        const second = await api('POST', `/workers/credentials/${credentialId}`, { token: studentWorker.token, body: { response: 'declined' } });
        check('a second answer to the same credential is refused', second.status === 409, `status ${second.status}`);

        const afterSecond = (
          await pool.query(`select status from public.micro_credentials where id = $1`, [credentialId])
        ).rows[0];
        check('the first answer survives a refused second one', afterSecond?.status === 'accepted', `status ${String(afterSecond?.status)}`);
      }

      if (studentWorker.token) {
        const { rows: proofRowsAfter } = await pool.query(
          `select count(*)::int n from public.work_proof_logs where worker_id = $1`,
          [studentWorker.id ?? '00000000-0000-0000-0000-000000000000'],
        );
        check('accepting a credential creates no work proof', proofRowsAfter[0].n === studentProofRowsBefore, `${studentProofRowsBefore} then ${proofRowsAfter[0].n}`);

        const { rows: verifRowsAfter } = await pool.query(
          `select count(*)::int n from public.verifications v
             join public.work_proof_logs p on p.id = v.work_proof_id
            where p.worker_id = $1`,
          [studentWorker.id ?? '00000000-0000-0000-0000-000000000000'],
        );
        check('accepting a credential creates no client verification', verifRowsAfter[0].n === 0, `${verifRowsAfter[0].n} verifications`);

        // The positive form of the same claim, read from the rows employer search
        // ranks on. A credential must move a student's client-verified total by
        // exactly zero, or a bootcamp that issued to a hundred graduates would make
        // all of them look client-verified on the one number employers filter by.
        const { rows: verifiedAfterRows } = await pool.query(
          `select count(distinct p.id)::int n
             from public.work_proof_logs p
            where p.worker_id = $1
              and exists (select 1 from public.verifications v2
                           where v2.work_proof_id = p.id and v2.response = 'confirmed')`,
          [studentWorker.id ?? '00000000-0000-0000-0000-000000000000'],
        );
        check(
          'an accepted credential does not change the client-verified proof total',
          verifiedAfterRows[0].n === studentVerifiedProofsBefore,
          `${studentVerifiedProofsBefore} before, ${verifiedAfterRows[0].n} after`,
        );

        const held = await api('GET', '/workers/credentials', { token: studentWorker.token });
        check('an accepted credential moves to the held list', held.json?.accepted?.length === 1, `${held.json?.accepted?.length} accepted`);
        check('an accepted credential leaves the awaiting list', held.json?.awaiting?.length === 0, `${held.json?.awaiting?.length} awaiting`);
      }

      // Declining is a first-class outcome, and a second student proves the list
      // distinguishes the two.
      let secondCredentialId = null;
      if (trainer.token && enrolmentId) {
        const secondIssued = await api('POST', '/trainers/credentials', {
          token: trainer.token,
          body: { enrolmentId, skillTag: 'Forge Welding', milestoneTitle: 'Forge welding refresher' },
        });
        secondCredentialId = secondIssued.json?.id ?? null;
      }
      if (studentWorker.token && secondCredentialId) {
        const declined = await api('POST', `/workers/credentials/${secondCredentialId}`, { token: studentWorker.token, body: { response: 'declined' } });
        check('the student can decline a credential', declined.status === 204, `status ${declined.status}`);

        const afterDecline = await api('GET', '/workers/credentials', { token: studentWorker.token });
        check('a declined credential is counted as declined, not accepted', afterDecline.json?.declinedCount === 1 && afterDecline.json?.accepted?.length === 1, `declined ${afterDecline.json?.declinedCount}, accepted ${afterDecline.json?.accepted?.length}`);

        const keptRow = (
          await pool.query(`select status from public.micro_credentials where id = $1`, [secondCredentialId])
        ).rows[0];
        check('a declined credential is kept rather than deleted', keptRow?.status === 'declined', `status ${String(keptRow?.status)}`);
      }

      // The institute sees the answers, so it knows what it actually certified.
      if (trainer.token) {
        const list = await api('GET', '/trainers/credentials', { token: trainer.token });
        check('the institute sees the credentials it issued', list.json?.credentials?.length === 2, `${list.json?.credentials?.length} credentials`);
        check('the institute sees one accepted and one declined', list.json?.acceptedCount === 1, `accepted ${list.json?.acceptedCount}`);
        check('the institute sees the declined one as not awaiting', list.json?.awaitingCount === 0, `awaiting ${list.json?.awaitingCount}`);

        const listBlob = JSON.stringify(list.json);
        check("the institute's credential list carries no email address", !listBlob.includes('@'), 'payload contained an address');
      }

      // Repeated credentials for one skill are allowed — two intakes of the same
      // syllabus are two credentials, and collapsing them would destroy a record of
      // which was which.
      if (trainer.token && enrolmentId) {
        const { rows: dupCheck } = await pool.query(
          `select count(*)::int n from public.micro_credentials
            where trainer_id = $1 and student_id = $2 and skill_tag = $3`,
          [trainer.id, studentWorker.id, 'Forge Welding'],
        );
        check('a student may hold two credentials for the same skill', dupCheck[0].n === 2, `${dupCheck[0].n} rows`);
      }

      // Removing a student keeps the credentials they already hold: leaving a
      // course does not un-take a practical somebody sat, and deleting the
      // endorsement would leave the institute with no record of what it certified.
      if (trainer.token && enrolmentId) {
        const removed = await api('DELETE', `/trainers/roster/${enrolmentId}`, { token: trainer.token });
        check('a student can be removed from the roster', removed.status === 204, `status ${removed.status}`);

        const { rows: keptCreds } = await pool.query(
          `select count(*)::int n from public.micro_credentials
            where trainer_id = $1 and student_id = $2`,
          [trainer.id, studentWorker.id],
        );
        check('credentials survive the student leaving the roster', keptCreds[0].n === 2, `${keptCreds[0].n} rows`);

        const goneAgain = await api('DELETE', `/trainers/roster/${enrolmentId}`, { token: trainer.token });
        check('removing a student twice is refused rather than repeated', goneAgain.status === 404, `status ${goneAgain.status}`);

        // The stored code is rotated away, and the old one stops working — which is
        // only possible because enrolment is a row rather than a property of the code.
        if (enrolmentCode) {
          const reused = await api('POST', '/workers/enrolment', { token: studentWorker.token, body: { code: enrolmentCode } });
          check('an enrolment code is scoped to the roster entry it created', reused.status === 200, `status ${reused.status}`);

          const { rows: stillOne } = await pool.query(
            `select count(*)::int n from public.trainer_students where trainer_id = $1 and student_id = $2`,
            [trainer.id, studentWorker.id],
          );
          check('re-enrolling does not duplicate the roster entry', stillOne[0].n === 1, `${stillOne[0].n} rows`);
        }
      }

      // Market demand. Derived entirely from rows the platform already holds.
      if (trainer.token) {
        const demand = await api('GET', '/trainers/demand', { token: trainer.token });
        check('the demand dashboard is readable', demand.status === 200, `status ${demand.status}`);
        check('the demand dashboard returns a skill list', Array.isArray(demand.json?.skills), typeof demand.json?.skills);
        check('the demand dashboard reports network totals', typeof demand.json?.totals?.activeSearches === 'number', JSON.stringify(demand.json?.totals));
        check('the demand dashboard states when it was read', typeof demand.json?.generatedAt === 'string', String(demand.json?.generatedAt));

        // The search this suite created earlier must show up, since it is a real
        // running spec. A dashboard that cannot see the network's own demand is
        // not a dashboard.
        const searched = (demand.json?.skills ?? []).find((row) => /solar panel/i.test(row.skillTag ?? ''));
        check('an employer search in this run appears as demand', Boolean(searched), JSON.stringify((demand.json?.skills ?? []).slice(0, 3).map((r) => r.skillTag)));
        check('demand is matched case-insensitively against worker skills', searched ? searched.activeSearches >= 1 : false, `activeSearches ${String(searched?.activeSearches)}`);

        // No gap may be negative. An oversupplied skill reading as a shortage would
        // invert the one recommendation this page exists to make.
        const negatives = (demand.json?.skills ?? []).filter((row) => (row.gapScore ?? -1) < 0);
        check('no skill is reported as having a negative gap', negatives.length === 0, JSON.stringify(negatives.map((r) => r.skillTag)));

        // Micro-credentials must not inflate supply, or an institute's own graduates
        // would inflate the shortage figure it uses to justify its curriculum.
        const supplyRow = (demand.json?.skills ?? []).find((row) => /forge welding/i.test(row.skillTag ?? ''));
        check('a credential-only skill does not appear as worker supply', supplyRow === undefined, `availableWorkers ${String(supplyRow?.availableWorkers)}`);

        const demandBlob = JSON.stringify(demand.json);
        check("the demand dashboard carries no worker's name", !/"fullName"|"studentName"|"displayName"/.test(demandBlob), 'demand payload contained a name');
        check("the demand dashboard carries no worker's address", !demandBlob.includes('@'), 'demand payload contained an address');
        check("the demand dashboard carries no worker's location", !/"(locationGps|latitude|longitude|coordinates)"/i.test(demandBlob), 'demand payload contained a location');

        const asEmployerDemand = employer.token
          ? await api('GET', '/trainers/demand', { token: employer.token })
          : { status: 0 };
        check('the demand dashboard is not open to other roles', asEmployerDemand.status === 403, `status ${asEmployerDemand.status}`);
      }

      if (trainer.token) {
        const overview = await api('GET', '/trainers/overview', { token: trainer.token });
        check('the institute dashboard is readable', overview.status === 200, `status ${overview.status}`);
        check('the institute dashboard counts its students', overview.json?.studentCount === 1, `studentCount ${String(overview.json?.studentCount)}`);
        check('the institute dashboard separates awaiting from accepted', typeof overview.json?.awaitingCredentials === 'number' && typeof overview.json?.acceptedCredentials === 'number', `${String(overview.json?.awaitingCredentials)} / ${String(overview.json?.acceptedCredentials)}`);
      }

      // The student's own view is the only place a credential is readable, and it is
      // not the same shape as the verified-proof overview, so a client cannot add
      // them together by accident.
      if (studentWorker.token) {
        const anonCreds = await api('GET', '/workers/credentials');
        check('the credentials list refuses an unauthenticated caller', anonCreds.status === 401, `status ${anonCreds.status}`);

        const workerCreds = await api('GET', '/workers/credentials', { token });
        check('one student cannot read another student credentials', workerCreds.status === 200, `status ${workerCreds.status}`);
        if (workerCreds.status === 200) {
          check("a worker's credential list is empty of another student's records", workerCreds.json?.accepted?.length === 0 && workerCreds.json?.awaiting?.length === 0, `${workerCreds.json?.accepted?.length} accepted, ${workerCreds.json?.awaiting?.length} awaiting`);
        }

        const unknownCredential = await api('POST', '/workers/credentials/00000000-0000-0000-0000-000000000000', { token: studentWorker.token, body: { response: 'accepted' } });
        check('answering a credential that does not exist is refused', unknownCredential.status === 404, `status ${unknownCredential.status}`);
      }

      // ---------------------------------------------------------------------
      // Phase 3's recovery path, end to end. The engine held a record earlier in
      // this suite; this is the journey from there back to a worker's income,
      // which is the part that used not to exist at all.
      section('WITHHELD RECORD: APPEAL, REVIEW, RESTORATION');
      if (token && adminAccount.token) {
        const held = (
          await pool.query(
            `select id, verification_status, flag_reason, review_status
               from public.work_proof_logs
              where worker_id = $1 and verification_status = 'flagged'
              order by flagged_at desc limit 1`,
            [userId],
          )
        ).rows[0];

        check(
          'the engine left a record held for a person to look at',
          Boolean(held),
          'no flagged proof found for this worker',
        );

        if (held) {
          const proofId = held.id;

          // --- The worker is told, before anything else -----------
          const detailBefore = await api('GET', `/workers/proofs/${proofId}`, { token });
          const before = detailBefore.json?.proof;
          check(
            'the worker can see the record was held',
            typeof before?.flaggedAt === 'string' && !Number.isNaN(Date.parse(before.flaggedAt)),
            JSON.stringify(before?.flaggedAt),
          );
          check(
            'the worker is shown a plain reason they can act on',
            typeof before?.flagReason === 'string' && before.flagReason.length > 0,
            String(before?.flagReason).slice(0, 90),
          );
          check(
            'the reason given to the worker contains no score or threshold',
            !/\d\.\d+/.test(String(before?.flagReason ?? '')),
            String(before?.flagReason).slice(0, 90),
          );
          check(
            'the worker is told it is not a finding of fraud',
            /not a finding of fraud/i.test(String(before?.flagReason ?? '')),
            String(before?.flagReason).slice(0, 90),
          );
          check(
            'the held record does not count as verified anywhere on the page',
            before?.verificationStatus === 'flagged',
            String(before?.verificationStatus),
          );
          check(
            'nothing is pending an answer any more',
            before?.verificationOutstanding === false,
            String(before?.verificationOutstanding),
          );

          // --- The appeal --------------------------------------------
          const strangerWorker = await mintAccount(
            `smoke.${stamp}.stranger@tetherproof.dev`,
            'worker',
            'Smoke Test Stranger',
          );
          if (strangerWorker.token) {
            const strangerAppeal = await api('POST', `/workers/proofs/${proofId}/appeal`, {
              token: strangerWorker.token,
              body: {},
            });
            check(
              "a worker cannot appeal someone else's record",
              strangerAppeal.status === 404,
              `status ${strangerAppeal.status}`,
            );
          }
          const employerAppeal = await api('POST', `/workers/proofs/${proofId}/appeal`, {
            token: employer.token,
            body: {},
          });
          check(
            'an employer cannot appeal a worker record at all',
            employerAppeal.status === 403,
            `status ${employerAppeal.status}`,
          );

          const appeal = await api('POST', `/workers/proofs/${proofId}/appeal`, {
            token,
            body: {},
          });
          check(
            'the owning worker can ask for it to be reviewed',
            appeal.status === 200 && appeal.json?.reviewStatus === 'appealed',
            JSON.stringify(appeal.json).slice(0, 120),
          );

          const secondAppeal = await api('POST', `/workers/proofs/${proofId}/appeal`, {
            token,
            body: {},
          });
          check(
            'asking twice does not queue it twice',
            secondAppeal.status === 409,
            `status ${secondAppeal.status}`,
          );

          // --- Who may decide ----------------------------------------
          const workerDecides = await api('POST', `/admin/proof-review/${proofId}`, {
            token,
            body: { outcome: 'overturned' },
          });
          check(
            'a worker cannot review their own record',
            workerDecides.status === 403,
            `status ${workerDecides.status}`,
          );

          const unauthDecides = await fetch(`${API}/admin/proof-review/${proofId}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ outcome: 'overturned' }),
          });
          check(
            'the review decision requires an administrator',
            unauthDecides.status === 401,
            `status ${unauthDecides.status}`,
          );

          const queue = await api('GET', '/admin/proof-review', { token: adminAccount.token });
          const queued = (queue.json?.items ?? []).find((item) => item.proofId === proofId);
          check(
            'the held record appears in the review queue',
            Boolean(queued),
            `${(queue.json?.items ?? []).length} item(s)`,
          );
          check(
            'the queue carries no worker identity',
            !JSON.stringify(queue.json ?? {}).includes(userId ?? ' '),
            'a worker id appeared in the queue',
          );
          check(
            'the queue shows the worker did ask for a review',
            queued?.reviewStatus === 'appealed',
            String(queued?.reviewStatus),
          );

          // --- Restoring ----------------------------------------------
          const restored = await api('POST', `/admin/proof-review/${proofId}`, {
            token: adminAccount.token,
            body: { outcome: 'overturned' },
          });
          check(
            'a reviewer can restore the record',
            restored.status === 200 && restored.json?.verificationStatus === 'verified',
            JSON.stringify(restored.json).slice(0, 120),
          );

          const afterRestore = (
            await pool.query(
              `select verification_status, review_status, restored_at, reviewed_by is not null as signed
                 from public.work_proof_logs where id = $1`,
              [proofId],
            )
          ).rows[0];
          check(
            'the restored record counts as verified again',
            afterRestore?.verification_status === 'verified',
            String(afterRestore?.verification_status),
          );
          check(
            'the review decision is recorded rather than inferred',
            afterRestore?.review_status === 'overturned',
            String(afterRestore?.review_status),
          );
          check(
            'the decision is attributed to the administrator who made it',
            afterRestore?.signed === true,
            'no reviewer id stored',
          );
          check(
            'the moment the record came back is recorded',
            afterRestore?.restored_at !== null,
            String(afterRestore?.restored_at),
          );

          // The findings themselves must survive the appeal. An appeal that erased
          // them would let anyone clear a genuine finding by objecting to it.
          const evidenceKept = (
            await pool.query(
              `select fraud_score, fraud_score_detail is not null as has_detail
                 from public.verifications where work_proof_id = $1`,
              [proofId],
            )
          ).rows[0];
          check(
            'an overturned review does not erase the engine findings',
            evidenceKept?.has_detail === true && evidenceKept?.fraud_score !== null,
            JSON.stringify(evidenceKept),
          );

          const secondDecision = await api('POST', `/admin/proof-review/${proofId}`, {
            token: adminAccount.token,
            body: { outcome: 'upheld' },
          });
          check(
            'a decision cannot be reversed by a second one',
            secondDecision.status === 409,
            `status ${secondDecision.status}`,
          );
          const stillVerified = (
            await pool.query('select verification_status from public.work_proof_logs where id = $1', [proofId])
          ).rows[0];
          check(
            'the refused second decision changed nothing',
            stillVerified?.verification_status === 'verified',
            String(stillVerified?.verification_status),
          );

          // --- What employers see --------------------------------------
          // The restored record now counts, and the earlier assurance that a
          // withheld record contributes nothing to a search still holds.
          const afterReview = await api('GET', `/workers/proofs/${proofId}`, { token });
          check(
            'the worker sees it was restored',
            typeof afterReview.json?.proof?.restoredAt === 'string' &&
              !Number.isNaN(Date.parse(afterReview.json.proof.restoredAt)),
            String(afterReview.json?.proof?.restoredAt),
          );
          check(
            'the worker sees it is back on their record',
            afterReview.json?.proof?.verificationStatus === 'verified',
            String(afterReview.json?.proof?.verificationStatus),
          );
          check(
            'the review outcome is still visible to the worker afterwards',
            afterReview.json?.proof?.reviewStatus === 'overturned',
            String(afterReview.json?.proof?.reviewStatus),
          );
        }
      }
    }

    section('NOTIFICATION READ STATE');
    {
      // Opening one notification is what marks it read. Reading the feed is not, and
      // the count has to track the row rather than a number the page happens to hold.
      const feed = await api('GET', '/notifications', { token });
      const feedBody = feed.json ?? {};
      const initialUnread = Number(feedBody.unreadCount ?? 0);
      const items = feedBody.notifications ?? [];

      check(
        'the feed reports an unread count',
        Number.isFinite(initialUnread) && initialUnread >= 0,
        String(initialUnread),
      );

      // Reading the feed must not have marked anything.
      const afterRead = await api('GET', '/notifications', { token });
      check(
        'opening the notifications page does not mark them read',
        Number(afterRead.json?.unreadCount ?? -1) === initialUnread,
        `${initialUnread} before, ${afterRead.json?.unreadCount} after`,
      );

      const unread = items.find((item) => !item.readAt);
      if (unread) {
        const marked = await api('POST', `/notifications/${unread.id}/read`, {
          token,
          body: {},
        });
        check(
          'tapping one notification marks it read',
          marked.status === 200 && marked.json?.marked === true,
          JSON.stringify(marked.json).slice(0, 120),
        );

        const afterOne = await api('GET', '/notifications', { token });
        check(
          'the unread count drops by exactly one',
          Number(afterOne.json?.unreadCount ?? -1) === initialUnread - 1,
          `${initialUnread} -> ${afterOne.json?.unreadCount}`,
        );

        const persisted = (afterOne.json?.notifications ?? []).find((item) => item.id === unread.id);
        check(
          'the read state is stored, not just counted',
          typeof persisted?.readAt === 'string' && !Number.isNaN(Date.parse(persisted.readAt)),
          String(persisted?.readAt),
        );

        // Reopening an already-read notification must not decrement again.
        const again = await api('POST', `/notifications/${unread.id}/read`, { token, body: {} });
        check(
          'reopening an already-read notification reports no change',
          again.status === 200 && again.json?.marked === false,
          JSON.stringify(again.json).slice(0, 120),
        );

        const afterAgain = await api('GET', '/notifications', { token });
        check(
          'reopening does not decrement the count a second time',
          Number(afterAgain.json?.unreadCount ?? -1) === initialUnread - 1,
          `${initialUnread} -> ${afterAgain.json?.unreadCount}`,
        );

        // The write is scoped to the owner. Without the owner in the predicate this
        // endpoint would let any signed-in member mark another's notification read.
        const stranger = await mintAccount(
          `smoke.${Date.now()}.notifstranger@tetherproof.dev`,
          'worker',
          'Smoke Test Notification Stranger',
        );
        if (stranger.token) {
          const foreign = await api('POST', `/notifications/${unread.id}/read`, {
            token: stranger.token,
            body: {},
          });
          check(
            "a member cannot mark someone else's notification read",
            foreign.status === 200 && foreign.json?.marked === false,
            JSON.stringify(foreign.json).slice(0, 120),
          );

          const stillRead = await api('GET', '/notifications', { token });
          check(
            'the notification was left alone by the attempt',
            Number(stillRead.json?.unreadCount ?? -1) === initialUnread - 1,
            String(stillRead.json?.unreadCount),
          );
        }

        const anonMark = await api('POST', `/notifications/${unread.id}/read`, { body: {} });
        check(
          'marking a notification read requires a session',
          anonMark.status === 401,
          `status ${anonMark.status}`,
        );

        // The bulk action is kept.
        const bulk = await api('POST', '/notifications/read', { token, body: {} });
        check(
          'mark all as read still works',
          bulk.status === 200 && typeof bulk.json?.marked === 'number',
          JSON.stringify(bulk.json).slice(0, 120),
        );
        const afterBulk = await api('GET', '/notifications', { token });
        check(
          'the unread count reaches zero once everything is read',
          Number(afterBulk.json?.unreadCount ?? -1) === 0,
          String(afterBulk.json?.unreadCount),
        );
      } else {
        check(
          'a notification was available to exercise the read path',
          false,
          `no unread notification among ${items.length}`,
        );
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
      //
      // `employer_saved_workers` joins that list for a stronger reason: each row
      // pairs one employer with one worker, so reading the table would map who is
      // interested in whom across the whole network. The policy is select-only and
      // scoped to `auth.uid()`, and this asserts the browser key cannot reach the
      // table at all rather than merely cannot reach another employer's rows.
      for (const table of [
        'employer_approvals',
        'candidate_handles',
        'direct_offers',
        'employer_saved_workers',
        // Phase 4b. A roster names a real person and a credential names a real
        // person, so a browser key reaching either would undo the privacy model the
        // whole module is built on. `trainer_enrolment_codes` is listed even though
        // it holds only a digest: RLS is enabled and forced with no policy at all
        // there, and this asserts a service-role-only table really is
        // service-role-only.
        'trainer_students',
        'micro_credentials',
        'trainer_enrolment_codes',
      ]) {
        const read = await anon.from(table).select('*').limit(1);
        // The table must EXIST. A missing relation also produces an error, and
        // treating that as a pass is precisely the defect this suite was previously
        // caught having: a security assertion that cannot fail. Asserted separately
        // so a table that was never created reads as a failure rather than as a
        // successfully enforced policy.
        const missing = /could not find the table|does not exist/i.test(read.error?.message ?? '');
        check(
          `public.${table} exists`,
          !missing,
          read.error?.message ?? 'no error',
        );
        check(
          `browser key cannot read public.${table}`,
          !missing && (Boolean(read.error) || (read.data ?? []).length === 0),
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
        // warning on every run Ã¢â‚¬â€ and a suite that always prints a warning is a
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
        // refuses deletion from SQL Ã¢â‚¬â€ verified rather than assumed Ã¢â‚¬â€ so the trigger
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
        // Scoped to this account. Asserting the whole table was empty meant a single
        // row left by any earlier interrupted run failed every later run for a
        // reason unrelated to the code under test Ã¢â‚¬â€ and the tempting "fix" is to
        // delete the row, which destroys the only record that those bytes exist.
        const leftovers = await pool.query(
          'select count(*)::int n from public.orphaned_proof_media where path like $1',
          [`${subjectId}/%`],
        );
        check(
          'this account left no removal-queue row for its own media',
          leftovers.rows[0].n === 0,
          `${leftovers.rows[0].n} row(s) for ${subjectId.slice(0, 8)}`,
        );
      }
    }

    if (WITH_WEB) {
      await runWebChecks({ pool, admin, createdUsers, apiProcess });
    }

    // ---------------------------------------------------------------------
    // Concurrency and replay are both covered above, on `summaryProof`: two
    // simultaneous taps are raced there, and the final replay is refused.
    // ---------------------------------------------------------------------
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
  finished = true;
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

    // The client renders the forms and holds the session cookie, so it carries
    // the same class of response headers as the API (doc/13 E-039). Checked on
    // a page that needs no token, so a header regression is reported even when
    // the confirmation flow itself is broken.
    const loginPage = await fetch(`${WEB}/login`);
    const webHeaders = loginPage.headers;
    const webHeader = (name) => webHeaders.get(name);
    check('web sets X-Content-Type-Options', webHeader('x-content-type-options') === 'nosniff', webHeader('x-content-type-options') ?? 'absent');
    check('web frames only itself', webHeader('x-frame-options') === 'SAMEORIGIN' && /frame-ancestors 'self'/.test(webHeader('content-security-policy') ?? ''), `${webHeader('x-frame-options') ?? 'no xfo'} / ${webHeader('content-security-policy') ?? 'no csp'}`);
    check('web suppresses the referrer (the token is in the path)', webHeader('referrer-policy') === 'no-referrer', webHeader('referrer-policy') ?? 'absent');
    check('web limits camera, microphone and location to itself', (webHeader('permissions-policy') ?? '').includes('geolocation=(self)') && (webHeader('permissions-policy') ?? '').includes('microphone=(self)') && (webHeader('permissions-policy') ?? '').includes('camera=(self)'), webHeader('permissions-policy') ?? 'absent');
    check('web states transport security', webHeader('strict-transport-security') !== null, webHeader('strict-transport-security') ?? 'absent');
    check('web does not advertise the framework', webHeader('x-powered-by') === null, webHeader('x-powered-by') ?? 'absent');
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
