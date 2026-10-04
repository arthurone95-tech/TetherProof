import { createHash, randomBytes } from 'node:crypto';
import { env } from '../config/env.js';

/**
 * Verification tokens are the live capability to confirm that work happened.
 *
 * The raw token is delivered once by SMS or WhatsApp and is never persisted.
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

/**
 * Normalises a phone number before hashing it.
 *
 * The same number reaches this function in several shapes: `+233241234567`,
 * `0234 123 4567`, `233-241-234567`. Hashing the raw string would treat those as
 * three different people and quietly defeat the collusion check, so separators
 * are stripped and a leading `00` international prefix is reduced to `+`.
 *
 * Deliberately does not do full E.164 conversion. That requires knowing the
 * country, and guessing it would merge distinct numbers, which is the one error
 * this function must not make.
 */
export function normalizePhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');

  if (digits.startsWith('00')) return `+${digits.slice(2)}`;
  if (digits.startsWith('+')) return `+${digits.slice(1).replace(/\D/g, '')}`;
  return digits;
}

/**
 * Salted hash of a verifier's phone number.
 *
 * Used to recognise that the same party confirmed several different proofs,
 * which is what the collusion filter needs and the only reason a verifier's
 * number is processed at all. The result is not reversible to the number, so the
 * database holds no client phone numbers.
 *
 * The salt comes from the environment rather than being hardcoded, because a
 * committed salt is a published salt. It does not need to be secret in the way a
 * password does, but it does need to be absent from the repository: with a known
 * salt these digests are brute-forceable over the reachable number space, since
 * phone numbers have very little entropy.
 */
export function hashVerifierPhone(phone: string): string {
  return createHash('sha256')
    .update(`${env.VERIFIER_PHONE_SALT}:${normalizePhone(phone)}`, 'utf8')
    .digest('hex');
}

export function expiryFromNow(ttlSeconds: number): Date {
  return new Date(Date.now() + ttlSeconds * 1000);
}
