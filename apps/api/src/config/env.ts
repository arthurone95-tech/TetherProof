import { z } from 'zod';
import { loadEnvFiles } from './load-env.js';

loadEnvFiles();

/**
 * Validated runtime configuration.
 *
 * The process refuses to start when a required variable is missing or
 * malformed, so a misconfigured deployment fails loudly instead of failing on
 * the first request that needs the value.
 */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'staging', 'production']).default('development'),
  PRODUCT_NAME: z.string().min(1).default('TetherProof'),

  API_HOST: z.string().min(1).default('127.0.0.1'),
  API_PORT: z.coerce.number().int().positive().default(4000),
  API_BASE_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),

  // Supabase project
  SUPABASE_URL: z.string().url('SUPABASE_URL must be a valid project URL'),
  SUPABASE_ANON_KEY: z.string().min(20, 'SUPABASE_ANON_KEY is required'),
  /**
   * Service-role key bypasses Row Level Security and must only ever exist in
   * the API server environment. It is never exposed to the browser.
   */
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20, 'SUPABASE_SERVICE_ROLE_KEY is required'),

  // PostgreSQL connection string for the Supabase database
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  DATABASE_SSL: z
    .string()
    .default('false')
    .transform((value) => value === 'true'),

  // Media proof storage bucket
  STORAGE_PROOFS_BUCKET: z.string().min(1).default('work-proofs'),
  STORAGE_MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(10 * 1024 * 1024),

  VERIFICATION_TOKEN_TTL: z.coerce.number().int().positive().default(259_200),

  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

export const env = {
  ...raw,
  isProduction: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
} as const;

export type Env = typeof env;
