import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as schema from './schema.js';

/**
 * Applies pending SQL migrations.
 *
 * Run with `npm run db:migrate`. The schema itself is never pushed directly,
 * so every change to the database is reviewable as a file in `drizzle/`.
 */
async function main(): Promise<void> {
  const usesSsl = env.DATABASE_SSL || /sslmode=require/.test(env.DATABASE_URL);

  const pool = new Pool({
    connectionString: env.DATABASE_URL,
    max: 1,
    // Supabase terminates TLS with a certificate that is not chain-verified
    // against the pooler hostname, so standard verification is disabled here.
    ...(usesSsl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  const db = drizzle(pool, { schema });

  try {
    await migrate(db, { migrationsFolder: './drizzle' });
    logger.info('Database migrations applied');
  } finally {
    await pool.end();
  }
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
