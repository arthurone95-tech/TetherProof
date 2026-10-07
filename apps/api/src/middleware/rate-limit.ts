import rateLimit from 'express-rate-limit';
import { ERROR_CODES } from '@tetherproof/shared';
import { env } from '../config/env.js';

function build(limit: number, windowMs: number, message: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // Rate limiting must not depend on a correct client IP being reported by
    // a proxy, so the key falls back to the raw socket address.
    keyGenerator: (req) => req.ip ?? req.socket.remoteAddress ?? 'unknown',
    message: {
      error: {
        code: ERROR_CODES.RATE_LIMITED,
        message,
        status: 429,
      },
    },
  });
}

/** Applies to credential endpoints such as login and registration. */
export const authRateLimiter = build(
  10,
  15 * 60 * 1000,
  'Too many attempts. Please wait a few minutes and try again.',
);

/**
 * Applies to proof media uploads.
 *
 * Uploads are the most expensive thing a signed-in caller can ask this API to do,
 * in CPU and in storage: every accepted request is decoded and re-encoded to
 * strip its metadata, then written to a bucket. The limit sits above
 * `authRateLimiter` because a worker legitimately submits several proofs in a
 * session, while remaining far below `globalRateLimiter` so one account cannot
 * absorb the whole budget. Paired with the file-size cap in `middleware/upload.ts`,
 * so the two together bound the cost of a single caller.
 */
export const mediaUploadRateLimiter = build(
  20,
  15 * 60 * 1000,
  'Too many uploads. Please wait a few minutes and try again.',
);

/**
 * Applies to sending a one-time sign-in code.
 *
 * Deliberately the tightest limit in the project. Every accepted request can
 * cost an SMS or email from the provider, so a loose limit would let one caller
 * spend the project's messaging quota, or send unsolicited messages to arbitrary
 * phone numbers, simply by repeating the request.
 */
export const confirmationRateLimiter = build(
  5,
  15 * 60 * 1000,
  'Too many codes requested. Please wait a few minutes and try again.',
);

/**
 * Applies to redeeming a one-time code.
 *
 * Looser than the send limit on purpose: a mistyped 6-digit code is an ordinary
 * mistake, and locking someone out for a quarter of an hour over a typo is a
 * worse outcome than the brute-force risk. Guessing is still bounded here, and
 * again by Supabase, which throttles verification attempts per token.
 */
export const codeVerificationRateLimiter = build(
  10,
  15 * 60 * 1000,
  'Too many attempts. Please wait a few minutes and try again.',
);

/**
 * Applies to the public, unauthenticated verification endpoints reached from
 * SMS/WhatsApp links. The window is deliberately short so a legitimate client
 * is never locked out by a slow tap.
 */
export const verificationRateLimiter = build(
  30,
  60 * 1000,
  'Too many requests. Please wait a moment and try again.',
);

/**
 * Applies to reverse-geocoding.
 *
 * Every accepted request costs an outbound call to the geocoding provider, and
 * the endpoint needs no session, so an anonymous caller could otherwise burn
 * the provider's budget or the API's egress by repeating it. The window is
 * wide because a worker legitimately locates a handful of jobs across a
 * session.
 */
export const locationRateLimiter = build(
  60,
  15 * 60 * 1000,
  'Too many location requests. Please wait a few minutes and try again.',
);

export const globalRateLimiter = build(300, 60 * 1000, 'Too many requests. Please slow down.');

export const rateLimitConfig = {
  trustProxy: env.isProduction,
};
