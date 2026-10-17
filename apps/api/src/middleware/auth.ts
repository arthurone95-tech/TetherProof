import type { NextFunction, Request, Response } from 'express';
import type { UserCapability } from '@tetherproof/shared';
import { AppError } from '../lib/errors.js';
import { readRoleClaim, resolveUserFromAccessToken } from '../lib/supabase.js';
import { listCapabilities } from '../modules/capabilities/service.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * The authenticated account.
       *
       * `capabilities` is the set that replaced the single `role` in migration `0012`, so
       * one person may hold several at once. `isAdmin` is separate and deliberate: an
       * administrator is a platform role rather than something a person does, it is read
       * from the server-controlled claim, and it is not grantable the way a capability
       * is. See `doc/13` E-024 for what happens when that distinction is lost.
       */
      auth?: {
        userId: string;
        capabilities: UserCapability[];
        isAdmin: boolean;
        email: string | null;
      };
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
 * What `authorize` accepts: a capability, or `admin`.
 *
 * `admin` is admissible here as a *requirement* — an admin-only route says so — while
 * never being grantable, because it is satisfied by the server-controlled claim and by
 * nothing else. Naming it in this type is what keeps `authorize('admin')` compiling without
 * inviting anyone to add it to `USER_CAPABILITIES`.
 */
type Authorizable = UserCapability | 'admin';

/**
 * Requires a valid Supabase access token.
 *
 * The token is verified against Supabase Auth on every request. The administrator flag
 * comes from the server-controlled `app_metadata` claim, which is the only place it is read
 * from; capabilities come from the database, because that is where they are granted and
 * revoked.
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

    // The full set, every request. A guard that only asked about the capability it cared
    // about would turn `authorize` back into a per-route query, and the whole point of
    // `0012` is that the answer is a set membership test against one load.
    const held = await listCapabilities(user.id);

    req.auth = {
      userId: user.id,
      capabilities: held,
      isAdmin: readRoleClaim(user) === 'admin',
      email: user.email ?? null,
    };
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Requires the authenticated caller to hold one of the allowed capabilities, or to be an
 * administrator.
 *
 * Always mounted after `authenticate`, so `req.auth` is guaranteed.
 *
 * Administrator is admitted here rather than being a capability, which is what keeps it
 * un-grantable: there is no row anybody can insert, and no request body that can name it.
 * A route that means *only* a capability — "this person must be a worker" — should use
 * `requireCapability`, because admitting an administrator to a worker's own records would
 * hand the platform's help desk the ability to read them, and nothing about fixing a
 * badge needs that.
 */
export function authorize(...allowed: Authorizable[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(AppError.unauthorized('Authentication is required.'));
      return;
    }
    if (req.auth.isAdmin) {
      next();
      return;
    }
    if (
      !allowed.some(
        (entry) => entry !== 'admin' && req.auth!.capabilities.includes(entry),
      )
    ) {
      next(AppError.forbidden());
      return;
    }
    next();
  };
}

/**
 * Requires exactly the named capabilities, with no administrator exemption.
 *
 * This is the guard for a person's *own* records — proofs, credentials, notifications.
 * An administrator is refused, because those routes read personal evidence about one
 * identifiable person and the platform's operational staff have no reason to hold them.
 * The routes that do need an administrator use `authorize`.
 */
export function requireCapability(...required: UserCapability[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) {
      next(AppError.unauthorized('Authentication is required.'));
      return;
    }
    if (required.every((capability) => req.auth!.capabilities.includes(capability))) {
      next();
      return;
    }
    next(AppError.forbidden());
  };
}
