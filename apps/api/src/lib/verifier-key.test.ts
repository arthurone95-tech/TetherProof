import { describe, expect, it } from 'vitest';
import { normalizeVerifierKey } from './verifier-key.js';
import { hashVerificationToken, hashVerifierKey } from './token.js';

/**
 * The pseudonymous verifier key, tested directly.
 *
 * Two properties matter and neither is visible from a request-level test:
 *
 * * **It is a pseudonym, not an identity.** A malformed value is treated as
 *   absent rather than repaired, because repairing it would invent a browser that
 *   does not exist and hand it to the collusion filter as though it had.
 * * **It is not forgeable across callers.** The digest is salted per deployment,
 *   so the same browser on two sites produces two different digests and a digest
 *   from one deployment means nothing in another.
 *
 * The header-only path that stops a request body overriding it is asserted in the
 * security suite against the real endpoint; these tests cover the function that
 * endpoint calls.
 */
describe('normalizeVerifierKey', () => {
  it('accepts a well-formed key and returns it unchanged', () => {
    const key = 'a'.repeat(48);
    expect(normalizeVerifierKey(key)).toBe(key);
  });

  it('rejects a key that is too short to be anything but a guess', () => {
    expect(normalizeVerifierKey('abc')).toBeNull();
  });

  it('rejects a key carrying characters the generator never produces', () => {
    const key = 'a'.repeat(47) + '!';
    expect(normalizeVerifierKey(key)).toBeNull();
  });

  it('treats an absent value as absent rather than repairing it', () => {
    expect(normalizeVerifierKey(undefined)).toBeNull();
    expect(normalizeVerifierKey(null)).toBeNull();
    expect(normalizeVerifierKey('')).toBeNull();
  });
});

describe('hashVerifierKey', () => {
  it('is deterministic for one key, so a repeat browser is recognisable', () => {
    const key = normalizeVerifierKey('b'.repeat(48))!;
    expect(hashVerifierKey(key)).toBe(hashVerifierKey(key));
  });

  it('separates two different browsers', () => {
    const a = hashVerifierKey(normalizeVerifierKey('a'.repeat(48))!);
    const b = hashVerifierKey(normalizeVerifierKey('b'.repeat(48))!);
    expect(a).not.toBe(b);
  });

  it('produces a 64-character hex digest, which is what the column holds', () => {
    const digest = hashVerifierKey(normalizeVerifierKey('c'.repeat(48))!);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('hashVerificationToken', () => {
  it('hashes rather than stores, so a token cannot be replayed from the database', () => {
    // This is the property the whole confirmation-link design rests on: a
    // database disclosure yields digests, and a digest is not a working link.
    const token = 'a-realistic-looking-verification-token-value';
    const digest = hashVerificationToken(token);

    expect(digest).not.toBe(token);
    expect(digest).not.toContain(token);
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it('separates two different tokens', () => {
    expect(hashVerificationToken('token-one')).not.toBe(hashVerificationToken('token-two'));
  });
});
