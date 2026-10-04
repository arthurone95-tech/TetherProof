/**
 * Applies the proof bucket's configuration to a Supabase project.
 *
 * The bucket must be private; that is the property that matters for
 * confidentiality. Its size cap and MIME allow-list are set separately, because
 * the management API accepts `file_size_limit` and `allowed_mime_types` in
 * `createBucket` and `updateBucket` and then silently discards both. Reading the
 * bucket back shows them unset, and an oversized or `text/plain` upload is stored
 * without complaint. The values therefore have to be written directly to
 * `storage.buckets`, which does persist them.
 *
 * Safe to re-run: it converges on the configuration below rather than assuming
 * anything about the current state, and it never marks the bucket public.
 *
 * Note that the limits are enforced by Storage, but the API's own checks remain
 * the first line: `ALLOWED_CONTENT_TYPES` in `src/lib/storage.ts` and the multer
 * size cap in `src/middleware/upload.ts` reject a bad upload before any bytes
 * reach the network. The bucket is a second layer, not the only one.
 */
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as loadDotenv } from 'dotenv';
import { Client } from 'pg';
import { createClient } from '@supabase/supabase-js';

function findEnvFile(): string | undefined {
  let directory = dirname(fileURLToPath(import.meta.url));

  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = join(directory, '.env');
    if (existsSync(candidate)) return candidate;

    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }

  return undefined;
}

const envFile = findEnvFile();
if (envFile) loadDotenv({ path: envFile });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DATABASE_URL = process.env.DATABASE_URL;

if (!SUPABASE_URL || !SERVICE_KEY || !DATABASE_URL) {
  console.error('SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and DATABASE_URL are required.');
  process.exit(1);
}

const BUCKET = process.env.STORAGE_PROOFS_BUCKET || 'work-proofs';
const MAX_BYTES = Number(process.env.STORAGE_MAX_UPLOAD_BYTES || 10485760);

/**
 * Must match `ALLOWED_CONTENT_TYPES` in `src/lib/storage.ts`.
 *
 * WebM is absent by design: its metadata cannot be stripped without re-muxing the
 * container, so it is not a format this project will store.
 */
const MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
];

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const db = new Client({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });
await db.connect();

try {
  const { data: buckets, error: listError } = await admin.storage.listBuckets();
  if (listError) {
    console.error(`could not list buckets: ${listError.message}`);
    process.exit(1);
  }

  const existing = (buckets ?? []).find((b) => b.name === BUCKET);

  if (!existing) {
    const { error } = await admin.storage.createBucket(BUCKET, { public: false });
    if (error) {
      console.error(`could not create bucket "${BUCKET}": ${error.message}`);
      process.exit(1);
    }
    console.log(`created bucket "${BUCKET}" (private)`);
  } else {
    console.log(`bucket "${BUCKET}" already exists`);
  }

  // Written directly, because the management API drops these values. See the note
  // at the top of this file.
  const { rowCount } = await db.query(
    `update storage.buckets
        set public = false,
            file_size_limit = $2,
            allowed_mime_types = $3::text[],
            updated_at = now()
      where name = $1`,
    [BUCKET, MAX_BYTES, MIME_TYPES],
  );

  if (rowCount === 0) {
    console.error(`bucket "${BUCKET}" vanished between the check and the update`);
    process.exit(1);
  }

  const row = (
    await db.query(
      'select public, file_size_limit, allowed_mime_types from storage.buckets where name = $1',
      [BUCKET],
    )
  ).rows[0];

  const sizeApplied = Number(row.file_size_limit) === MAX_BYTES;
  const mimesApplied =
    Array.isArray(row.allowed_mime_types) &&
    row.allowed_mime_types.length === MIME_TYPES.length &&
    MIME_TYPES.every((m) => row.allowed_mime_types.includes(m));

  console.log(`\n  public             = ${row.public}`);
  console.log(`  file_size_limit    = ${row.file_size_limit ?? 'NOT SET'}`);
  console.log(`  allowed_mime_types = ${JSON.stringify(row.allowed_mime_types) ?? 'NOT SET'}\n`);

  if (row.public !== false) {
    console.error('bucket is not private; refusing to report success');
    process.exit(1);
  }
  if (!sizeApplied || !mimesApplied) {
    console.error('limits did not persist. Storage will accept any type and any size.');
    console.error('The API-layer checks are still enforced and remain the first line of defence.');
    process.exit(1);
  }

  console.log('limits applied and verified.');
} finally {
  await db.end();
}