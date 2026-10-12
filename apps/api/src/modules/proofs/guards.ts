/**
 * Small helpers shared by route modules that read the session or a proof id.
 *
 * These are duplicated in three places in the codebase today — employers, proofs,
 * and the review routes — and each copy risks drifting from the others on a rule
 * as small as "what a proof id looks like". A fourth copy would be a fourth
 * chance to get it wrong, so they live here instead.
 */
import type { Request } from 'express';
import { AppError } from '../../lib/errors.js';

/**
 * Reads the authenticated account.
 *
 * Every route using this runs behind `authenticate`, which is the only thing that
 * sets `req.auth`. This is a type narrowing, not a second authorization step.
 */
export function account(req: Request): { userId: string } {
  const auth = req.auth;
  if (!auth) throw new Error('authenticate must run first');
  return auth;
}

/**
 * Rejects a route parameter that cannot be a proof id.
 *
 * The expression layer would answer a non-UUID with a Postgres syntax error — a
 * 500 that leaks nothing but tells a caller nothing either — so refusing it here
 * turns the same request into the same 404 an unknown id gets.
 */
export function requireProofId(value: string | undefined): string {
  if (
    !value ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw AppError.notFound('That log entry was not found.');
  }
  return value;
}
