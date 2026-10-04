import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import * as schema from './schema.js';

export const pool = new Pool({
  connectionString: env.DATABASE_URL,
  max: env.DATABASE_POOL_MAX,
  ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : undefined,
  application_name: `${env.PRODUCT_NAME}-api`,
});

pool.on('error', (error) => {
  logger.error('Unexpected error on idle database client', { error: error.message });
});

export const db = drizzle(pool, { schema });

export type Database = typeof db;

export async function checkDatabaseConnection(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database health check failed', {
      error: error instanceof Error ? error.message : 'unknown error',
    });
    return false;
  }
}

export async function closeDatabase(): Promise<void> {
  await pool.end();
}
