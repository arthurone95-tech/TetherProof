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
