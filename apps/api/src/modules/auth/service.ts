import { eq } from 'drizzle-orm';
import { ERROR_CODES, USER_ROLES } from '@tetherproof/shared';
import type {
  AuthResponse,
  AuthSession,
  AuthUser,
  ConfirmationChallenge,
  UserRole,
} from '@tetherproof/shared';
import { logger } from '../../config/logger.js';
import { db } from '../../db/client.js';
import { profiles, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { supabaseAdmin, supabaseAuth } from '../../lib/supabase.js';
import type { ConfirmInput, ConfirmRequestInput, LoginInput, RegisterInput } from './schemas.js';

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

/** The two channels an account can prove ownership of. */
type Channel = 'email' | 'phone';

/**
 * Masks a contact detail before it is returned or logged.
 *
 * The caller supplied the value, so this is a readability and log-hygiene guard
 * rather than a secrecy control: it keeps a full phone number or address out of
 * responses and out of log lines.
 */
function maskDestination(value: string): string {
  const trimmed = value.trim();

  if (trimmed.includes('@')) {
    const [local = '', domain = ''] = trimmed.split('@');
    return `${local.slice(0, 1)}***@${domain}`;
  }

  return `***${trimmed.replace(/\D/g, '').slice(-3)}`;
}

/** Shapes a Supabase user into the public auth contract. */
function toAuthUser(user: {
  id: string;
  email?: string | null;
  phone?: string | null;
  app_metadata?: Record<string, unknown>;
}): AuthUser {
  return {
    id: user.id,
    role: readRoleClaim(user.app_metadata?.role),
    email: user.email ?? null,
    phone: user.phone ?? null,
  };
}

function toAuthSession(session: {
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}): AuthSession {
  return {
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    expiresIn: session.expires_in ?? 3600,
  };
}

/**
 * Asks Supabase Auth to deliver a one-time code to an existing account.
 *
 * `shouldCreateUser: false` is the load-bearing option: it stops the provider
 * creating an account for an unknown destination and stops it spending quota on
 * one, so this never confirms to a caller whether the destination is
 * registered.
 *
 * Never throws. A provider outage must not fail registration, and the caller can
 * always retry through `POST /auth/confirm/request`.
 */
async function deliverCode(channel: Channel, value: string): Promise<boolean> {
  const target = channel === 'email' ? { email: value } : { phone: value };

  const { error } = await supabaseAuth.auth.signInWithOtp({
    ...target,
    options: { shouldCreateUser: false },
  });

  if (error) {
    // Logged rather than returned. The reason may reveal whether the
    // destination exists, so it must not reach the caller.
    logger.warn('Confirmation code was not delivered', {
      channel,
      reason: error.message,
    });
    return false;
  }

  return true;
}

/**
 * Marks exactly the channel the caller just proved as confirmed.
 *
 * Only the proven channel is ever set. Writing `false` for the other channel
 * would revoke a confirmation the user already earned, and setting both would
 * let someone who signed up by email skip proving ownership of a phone number.
 *
 * GoTrue normally sets this during verification; persisting it explicitly keeps
 * password sign-in working regardless of that internal detail.
 */
async function confirmVerifiedChannel(userId: string, channel: Channel): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.updateUserById(userId, {
    ...(channel === 'email' ? { email_confirm: true } : { phone_confirm: true }),
  });

  if (error) {
    // The session is already valid, so the request still succeeds, but an
    // unconfirmed account cannot sign in with a password. Logged as an error
    // because it needs a human to look at it.
    logger.error('Failed to persist channel confirmation', {
      userId,
      channel,
      reason: error.message,
    });
  }
}

export async function register(input: RegisterInput): Promise<AuthResponse> {
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

  // The product is phone-first, so a phone number is the preferred channel when
  // the member supplied both. Sign-in stays blocked until it is proven.
  const channel: Channel = input.phoneNumber ? 'phone' : 'email';
  const destination = input.phoneNumber ?? input.email!;

  const confirmation: ConfirmationChallenge = {
    channel,
    destination: maskDestination(destination),
    delivered: await deliverCode(channel, destination),
  };

  return {
    user: { id: data.user.id, role, email: data.user.email ?? null, phone: data.user.phone ?? null },
    session: null,
    confirmation,
  };
}

/**
 * Sends, or re-sends, a one-time sign-in code.
 *
 * The response shape is identical whether or not the account exists, and
 * `delivered` is also false when the provider is merely unhealthy, so the
 * endpoint cannot be used to discover which phone numbers or addresses are
 * registered.
 *
 * Known limitation: a registered destination takes marginally longer to answer
 * because the provider is actually contacted. Closing that timing gap would
 * require the API to issue codes itself and deliver them through a gateway.
 */
export async function requestConfirmation(
  input: ConfirmRequestInput,
): Promise<ConfirmationChallenge> {
  const channel: Channel = input.phoneNumber ? 'phone' : 'email';
  const destination = input.phoneNumber ?? input.email!;

  return {
    channel,
    destination: maskDestination(destination),
    delivered: await deliverCode(channel, destination),
  };
}

/**
 * Exchanges a one-time code for a session, confirming the account as a side
 * effect. This is what removes the need for an administrator to confirm new
 * members by hand (E-007).
 */
export async function confirm(input: ConfirmInput): Promise<AuthResponse> {
  const channel: Channel = input.phoneNumber ? 'phone' : 'email';
  const destination = input.phoneNumber ?? input.email!;

  /**
   * Supabase accepts the two forms of credential through different parameters:
   * a short numeric code is passed as `token` alongside the address, while a
   * magic-link token is passed as `token_hash` and must be sent *without* the
   * address, or the provider refuses it with "Only the token_hash and type
   * should be provided".
   *
   * Neither form is interchangeable with the other, and the token itself is the
   * credential in both cases. Because either Auth template may be enabled, the
   * shape of the value decides which parameter set is used.
   */
  const isNumericCode = /^\d{6,10}$/.test(input.token);
  const verificationType = channel === 'email' ? ('email' as const) : ('sms' as const);
  const target = channel === 'email' ? { email: destination } : { phone: destination };

  const { data, error } = await supabaseAuth.auth.verifyOtp(
    isNumericCode
      ? { ...target, token: input.token, type: verificationType }
      : { token_hash: input.token, type: verificationType },
  );

  // Supabase reports a wrong code, an expired code, and an already-used code
  // with indistinguishable messages. One generic reply is returned so a caller
  // cannot learn which of the three they hit.
  if (error || !data.user || !data.session) {
    throw AppError.coded(
      ERROR_CODES.AUTH_CODE_INVALID,
      'That code is not valid. Check the code you received and try again.',
      400,
    );
  }

  await confirmVerifiedChannel(data.user.id, channel);

  return {
    user: toAuthUser(data.user),
    session: toAuthSession(data.session),
    confirmation: null,
  };
}

/**
 * Verifies credentials through Supabase Auth.
 *
 * The Supabase message is intentionally not forwarded, so an attacker cannot
 * use the response to learn whether a phone number or email is registered.
 */
export async function login(input: LoginInput): Promise<AuthResponse> {
  const credentials = input.email
    ? { email: input.email, password: input.password }
    : { phone: input.phoneNumber!, password: input.password };

  const { data, error } = await supabaseAdmin.auth.signInWithPassword(credentials);

  if (error || !data.user || !data.session) {
    throw AppError.unauthorized('Incorrect sign-in details.');
  }

  return {
    user: toAuthUser(data.user),
    session: toAuthSession(data.session),
    confirmation: null,
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
