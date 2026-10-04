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

  const createdUsers = [];
  /** Bucket objects this run stored, removed during cleanup. */
  const storedPaths = [];
  /** Hoisted so the cleanup closure can scope its deletes to this run's worker. */
  let workerId = null;
  let apiProcess;

  const cleanup = async () => {
    section('CLEANUP');
    try {
      // Stored objects first, so a failure here cannot leave media behind even if
      // the row deletes below are refused by a foreign key. Probe paths are
      // tracked too, so the stray-object check stays strict.
      if (storedPaths.length > 0) {
        const removed = await admin.storage
          .from(process.env.STORAGE_PROOFS_BUCKET || 'work-proofs')
          .remove(storedPaths);
        check(
          'stored proof media removed from the bucket',
          !removed.error,
          removed.error?.message ?? `${storedPaths.length} object(s)`,
        );
      }

      // Scoped to the workers THIS RUN created, tracked by id. These deletes
      // used to be unscoped, which would have destroyed a real member's proofs,
      // capability blocks, and verifications if the suite were ever run against
      // live data. They then narrowed too far, to a single worker: the `--web`
      // path creates a second one, and scoping to only the first left its rows
      // behind, which made the auth delete fail on a surviving foreign key and
      // leaked an account on every web run.
      const owned = createdUsers.length > 0 ? createdUsers : [workerId].filter(Boolean);
      if (owned.length > 0) {
        await pool.query(
          `delete from public.verifications where work_proof_id in
             (select id from public.work_proof_logs where worker_id = any($1::uuid[]))`,
          [owned],
        );
        await pool.query('delete from public.work_proof_logs where worker_id = any($1::uuid[])', [owned]);
        await pool.query('delete from public.capability_blocks where worker_id = any($1::uuid[])', [owned]);
      }

      for (const id of createdUsers) {
        const del = await admin.auth.admin.deleteUser(id);
        if (del.error) console.log(`   warning: could not delete ${id}: ${del.error.message}`);
      }

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
      for (const t of ['work_proof_logs', 'capability_blocks']) {
        const { rows } = await pool.query(
          `select count(*)::int n from public.${t} t
             where not exists (select 1 from auth.users u where u.id = t.worker_id)`,
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
    for (const u of leftovers) await admin.auth.admin.deleteUser(u.id).catch(() => undefined);
    check('no leftover accounts from an earlier run', leftovers.length === 0, `${leftovers.length} removed`);

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

      // These submissions stored real objects in the bucket. They have to be tracked
      // for removal, or the stray-object check at the end fails on media this run
      // created and nobody has cleaned up.
      const { rows: engineMedia } = await pool.query(
        'select media_url from public.work_proof_logs where worker_id = $1 and media_url is not null',
        [userId],
      );
      for (const m of engineMedia) {
        if (!storedPaths.includes(m.media_url)) storedPaths.push(m.media_url);
      }
      check(
        'every proof this run submitted has its media tracked for removal',
        engineMedia.every((m) => storedPaths.includes(m.media_url)),
        `${engineMedia.length} object(s)`,
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

    section('ROW LEVEL SECURITY');
    const anon = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
      auth: { persistSession: false },
    });
    const readUsers = await anon.from('users').select('*').limit(1);
    check('browser key cannot read public.users', Boolean(readUsers.error) || (readUsers.data ?? []).length === 0, readUsers.error?.message ?? 'no rows');

    const readProofs = await anon.from('work_proof_logs').select('*').limit(1);
    check('browser key cannot read work_proof_logs', Boolean(readProofs.error) || (readProofs.data ?? []).length === 0, readProofs.error?.message ?? 'no rows');

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