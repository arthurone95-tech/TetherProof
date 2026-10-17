import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as schema from './schema.js';

/**
 * Applies pending SQL migrations.
 *
 * Run with `npm run db:migrate`. The schema itself is never pushed directly,
 * so every change to the database is reviewable as a file in `drizzle/`.
 *
 * ## `--to <tag>`
 *
 * Applies migrations only up to and including the named one, which is what makes an
 * expand/contract release possible.
 *
 * `drizzle`'s migrator always applies every journal entry it finds, so a split migration —
 * one that must not be applied until a deploy has happened — cannot be held back with the
 * stock runner. Rather than reimplement the migrator, this builds a temporary folder
 * containing a copy of every migration up to the target plus a journal truncated at the
 * same point, and points `migrate()` at that. Drizzle still does the work: it still decides
 * what is pending, still runs each migration in its own transaction, and still records it in
 * the real `drizzle.__drizzle_migrations` table. Only the set of files it can see is
 * narrowed, so nothing downstream differs from a normal run.
 *
 *     npm run db:migrate -- --to 0012_multi_capability
 *
 * Running `--to` later with the full folder applies only what remains.
 */
async function main(): Promise<void> {
  const usesSsl = env.DATABASE_SSL || /sslmode=require/.test(env.DATABASE_URL);
  const source = resolve('./drizzle');
  const toIndex = parseStopAt(source);

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    // Supabase terminates TLS with a certificate that is not chain-verified
    // against the pooler hostname, so standard verification is disabled here.
    ...(usesSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  const db = drizzle(pool, { schema });

  let folder = source;
  let scratch: string | null = null;

  try {
    if (toIndex !== null) {
      scratch = buildTruncatedFolder(source, toIndex);
      folder = scratch;
      logger.info('Applying migrations up to a named tag', { index: toIndex });
    }
    await migrate(db, { migrationsFolder: folder });
    logger.info('Database migrations applied');
  } finally {
    await pool.end();
    if (scratch) rmSync(scratch, { recursive: true, force: true });
  }
}

/** `--to <tag>` -> journal index, or null when the flag is absent. */
function parseStopAt(source: string): number | null {
  const flag = process.argv.indexOf('--to');
  if (flag === -1) return null;
  const tag = process.argv[flag + 1];
  if (!tag) throw new Error('--to needs a migration tag, for example --to 0012_multi_capability');

  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };
  const found = journal.entries.find((entry) => entry.tag === tag);
  if (!found) {
    throw new Error(
      `No migration tagged "${tag}". Available: ${journal.entries.map((e) => e.tag).join(', ')}`,
    );
  }
  return found.idx;
}

/**
 * Copies the migrations up to `stopAt` into a temp folder with a matching journal.
 *
 * The `meta/_snapshots` directory is copied too because drizzle reads it while loading the
 * journal; without it the folder looks malformed.
 */
function buildTruncatedFolder(source: string, stopAt: number): string {
  const scratch = mkdtempSync(join(tmpdir(), 'tetherproof-migrate-'));
  const journal = JSON.parse(readFileSync(join(source, 'meta/_journal.json'), 'utf8')) as {
    entries: Array<{ idx: number; tag: string }>;
  };

  mkdirSync(join(scratch, 'meta'), { recursive: true });
  writeFileSync(
    join(scratch, 'meta/_journal.json'),
    JSON.stringify(
      { ...journal, entries: journal.entries.filter((e) => e.idx <= stopAt) },
      null,
      2,
    ),
  );

  const snapshots = join(source, 'meta/_snapshots');
  try {
    cpSync(snapshots, join(scratch, 'meta/_snapshots'), { recursive: true });
  } catch {
    // No snapshots recorded. Drizzle tolerates their absence when it is not generating.
  }

  for (const entry of journal.entries.filter((e) => e.idx <= stopAt)) {
    const file = join(source, `${entry.tag}.sql`);
    cpSync(file, join(scratch, `${entry.tag}.sql`));
  }

  logger.info('Built a truncated migration folder', {
    through: journal.entries.find((e) => e.idx === stopAt)?.tag,
    migrations: journal.entries.filter((e) => e.idx <= stopAt).length,
  });
  return scratch;
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    // `pg` wraps the server error in `cause`, which holds the actionable
    // message. Without it a migration failure is undebuggable.
    const cause =
      error instanceof Error && error.cause instanceof Error ? error.cause.message : undefined;

    const hint = message.includes('does not exist')
      ? ' The drizzle/ migrations folder may be missing. Run `npm run db:generate` first.'
      : '';

    logger.error('Migration failed', { error: cause ?? message });
    console.error(`Migration failed: ${cause ?? message}${hint}`);
    process.exit(1);
  });