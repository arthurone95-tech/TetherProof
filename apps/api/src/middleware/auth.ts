import type { NextFunction, Request, Response } from 'express';
import type { UserRole } from '@tetherproof/shared';
import { AppError } from '../lib/errors.js';
import { readRoleClaim, resolveUserFromAccessToken } from '../lib/supabase.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: { userId: string; role: UserRole; email: string | null };
    }
  }
}

function extractBearerToken(req: Request): string | undefined {
  const header = req.header('authorization');
  if (!header) return undefined;
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) return undefined;
  return token.trim() || undefined;
}

/**
 * Requires a valid Supabase access token.
 *
 * The token is verified against Supabase Auth on every request, and the role
 * is read from the server-controlled `app_metadata` claim rather than from
 * anything the caller supplied.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    next(AppError.unauthorized('Authentication is required.'));
    return;
  }

  try {
    const user = await resolveUserFromAccessToken(token);
    if (!user) {
      next(AppError.unauthorized('Invalid or expired access token.'));
      return;
    }

    const roleClaim = readRoleClaim(user);
    if (!roleClaim) {
      next(AppError.forbidden('This account has no assigned role.'));
      return;
    }

    req.auth = {
      userId: user.id,
      role: roleClaim as UserRole,
      email: user.email ?? null,
    };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Requires the authenticated caller to hold one of the allowed roles.
 *
 * Always mounted after `authenticate`, so `req.auth` is guaranteed.
 */
export function authorize(...allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(AppError.unauthorized('Authentication is required.'));
      return;
    }
    if (!allowed.includes(req.auth.role)) {
      next(AppError.forbidden());
      return;
    }
    next();
  };
}
