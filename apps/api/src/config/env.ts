import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { loadEnvFiles } from './load-env.js';
import { logger } from './logger.js';

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

  /**
   * Public origin of the web client, used to build the link a client taps.
   *
   * Defaults to empty rather than to a guess, because a wrong value would send
   * people to a link that 404s. An empty value disables dispatch instead, and
   * the worker still receives the token in the API response.
   */
  WEB_BASE_URL: z
    .string()
    .default('')
    .refine((value) => value === '' || /^https?:\/\//.test(value), {
      message: 'WEB_BASE_URL must start with http:// or https:// when set',
    }),

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

  /**
   * Salt for hashing verifier phone numbers.
   *
   * Not given a default, because a default salt is a published salt. A salt is
   * not confidential in the way a password is, but a known salt reduces a phone
   * hash to a bare digest, and phone numbers have so little entropy that a bare
   * digest is reversible by brute force over the reachable number space.
   *
   * Required in production. Outside it, a random one is generated per process so
   * a fresh checkout still runs, with a warning: hashes will not match across
   * restarts, which costs collusion history but nothing else.
   */
  VERIFIER_PHONE_SALT: z.string().default(''),

  // Anti-fraud engine
  /**
   * Distance in km still treated as the same site. Compared against the
   * worker's submission point and the client's tap.
   */
  FRAUD_PROXIMITY_KM: z.coerce.number().positive().default(2),
  /**
   * Score at or below which a confirmed proof is marked `fraud_blocked`.
   * Must fall strictly between zero and one; asserted at startup.
   */
  FRAUD_BLOCK_BELOW: z.coerce.number().default(0.25),

  // Outbound verification messages
  MESSAGING_PROVIDER: z.enum(['twilio', 'log']).default('log'),
  TWILIO_ACCOUNT_SID: z.string().default(''),
  TWILIO_AUTH_TOKEN: z.string().default(''),
  TWILIO_FROM_NUMBER: z.string().default(''),

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

// Checked here rather than at first use, so a deployment that cannot work is
// refused at startup instead of failing silently on a worker's first proof.
if (!(raw.FRAUD_BLOCK_BELOW > 0 && raw.FRAUD_BLOCK_BELOW < 1)) {
  throw new Error('Invalid environment configuration:\n  - FRAUD_BLOCK_BELOW: must be between 0 and 1');
}

/**
 * A production deployment must supply its own salt.
 *
 * Refusing to start is the point. A generated salt would change on every
 * restart or redeploy, so previously hashed verifier phones would stop matching
 * and the collusion filter would quietly start treating returning verifiers as
 * new ones, with nothing in the logs to say why.
 */
function resolveVerifierSalt(value: string): string {
  if (value.length >= 16) return value;

  if (raw.NODE_ENV === 'production') {
    throw new Error(
      'Invalid environment configuration:\n  - VERIFIER_PHONE_SALT: required in production, at least 16 characters',
    );
  }

  const generated = randomBytes(32).toString('hex');
  logger.warn(
    'VERIFIER_PHONE_SALT is not set; using a random per-process salt. Verifier phone hashes will not match across restarts.',
  );
  return generated;
}

export const env = {
  ...raw,
  VERIFIER_PHONE_SALT: resolveVerifierSalt(raw.VERIFIER_PHONE_SALT),
  isProduction: raw.NODE_ENV === 'production',
  corsOrigins: raw.CORS_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0),
} as const;

export type Env = typeof env;
