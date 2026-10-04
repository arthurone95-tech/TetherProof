import { eq } from 'drizzle-orm';
import { USER_ROLES } from '@tetherproof/shared';
import type { UserRole } from '@tetherproof/shared';
import { db } from '../../db/client.js';
import { profiles, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { supabaseAdmin } from '../../lib/supabase.js';
import type { LoginInput, RegisterInput } from './schemas.js';

/**
 * Reads the server-controlled role claim.
 *
 * The claim is only ever written by this server, but it is still validated
 * against the known set rather than cast blindly, so an unexpected value can
 * never widen a caller's access.
 */
function readRoleClaim(claim: unknown): UserRole {
  return typeof claim === 'string' && (USER_ROLES as readonly string[]).includes(claim)
    ? (claim as UserRole)
    : 'worker';
}

export interface AuthResult {
  user: { id: string; role: UserRole; email: string | null; phone: string | null };
  session: { accessToken: string; refreshToken: string; expiresIn: number } | null;
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const role = input.role;

  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email ?? undefined,
    phone: input.phoneNumber ?? undefined,
    password: input.password,
    // `user_metadata` is editable by the account holder, so it never carries
    // authorization decisions. The role claim is written here, server-side.
    user_metadata: input.fullName ? { full_name: input.fullName } : {},
    app_metadata: { role },
    email_confirm: false,
    phone_confirm: false,
  });

  if (error || !data.user) {
    const message = error?.message ?? 'Account could not be created.';
    if (/already|registered|exists/i.test(message)) {
      throw AppError.conflict('An account with these sign-in details already exists.');
    }
    throw AppError.badRequest('Account could not be created with these details.');
  }

  // The `on_auth_user_created` trigger is the only writer of `public.users`:
  // it reads the role from `app_metadata` at insert time. Writing the row here
  // as well would collide on the primary key.
  await db.insert(profiles).values({
    userId: data.user.id,
    fullName: input.fullName ?? null,
  });

  return {
    user: { id: data.user.id, role, email: data.user.email ?? null, phone: data.user.phone ?? null },
    session: null,
  };
}

/**
 * Verifies credentials through Supabase Auth.
 *
 * The Supabase message is intentionally not forwarded, so an attacker cannot
 * use the response to learn whether a phone number or email is registered.
 */
export async function login(input: LoginInput): Promise<AuthResult> {
  const credentials = input.email
    ? { email: input.email, password: input.password }
    : { phone: input.phoneNumber!, password: input.password };

  const { data, error } = await supabaseAdmin.auth.signInWithPassword(credentials);

  if (error || !data.user || !data.session) {
    throw AppError.unauthorized('Incorrect sign-in details.');
  }

  const role = readRoleClaim(data.user.app_metadata?.role);

  return {
    user: {
      id: data.user.id,
      role,
      email: data.user.email ?? null,
      phone: data.user.phone ?? null,
    },
    session: {
      accessToken: data.session.access_token,
      refreshToken: data.session.refresh_token,
      expiresIn: data.session.expires_in ?? 3600,
    },
  };
}

/** Reads the application profile for the authenticated caller. */
export async function getProfile(userId: string) {
  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      fullName: profiles.fullName,
      locationCity: profiles.locationCity,
      organizationName: profiles.organizationName,
      avatarUrl: profiles.avatarUrl,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw AppError.notFound('Profile not found.');
  }
  return row;
}
