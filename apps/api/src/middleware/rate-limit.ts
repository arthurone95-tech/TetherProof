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

export const globalRateLimiter = build(300, 60 * 1000, 'Too many requests. Please slow down.');

export const rateLimitConfig = {
  trustProxy: env.isProduction,
};
