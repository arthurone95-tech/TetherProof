import { createHash, randomBytes } from 'node:crypto';

/**
 * Verification tokens are the live capability to confirm that work happened.
 *
 * The raw token is delivered once over SMS/WhatsApp and is never persisted.
 * Only its SHA-256 digest is stored, so a leaked database row cannot be
 * replayed to confirm work on a worker's behalf.
 */

const TOKEN_BYTES = 32;

export function generateVerificationToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashVerificationToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function expiryFromNow(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}
