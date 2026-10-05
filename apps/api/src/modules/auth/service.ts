import { eq, inArray, like } from 'drizzle-orm';
import { ERROR_CODES, USER_ROLES } from '@tetherproof/shared';
import type {
  AccountDeletionResult,
  AuthResponse,
  AuthSession,
  AuthUser,
  ConfirmationChallenge,
  ProfileResponse,
  UserRole,
} from '@tetherproof/shared';
import { logger } from '../../config/logger.js';
import { db } from '../../db/client.js';
import { orphanedProofMedia, profiles, users } from '../../db/schema.js';
import { AppError } from '../../lib/errors.js';
import { supabaseAdmin, supabaseAuth } from '../../lib/supabase.js';
import type {
  ConfirmInput,
  ConfirmRequestInput,
  LoginInput,
  RegisterInput,
  UpdateProfileInput,
} from './schemas.js';

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

  // Signed in on the anon client, never the service-role one. Signing in stores a
  // session on whichever client performed it, and that session then replaces the
  // service key on every later request through it, silently reducing the shared
  // admin client to an ordinary user session. Signing in requires no elevated
  // privilege, so there is no reason to involve the admin client here.
  const { data, error } = await supabaseAuth.auth.signInWithPassword(credentials);

  if (error || !data.user || !data.session) {
    throw AppError.unauthorized('Incorrect sign-in details.');
  }

  return {
    user: toAuthUser(data.user),
    session: toAuthSession(data.session),
    confirmation: null,
  };
}

/**
 * Deletes the caller's own account and anonymises the work they leave behind.
 *
 * Split into two phases because one of them cannot be done here. The database
 * trigger scrubs every column and records which stored objects still need a
 * byte-level delete, but SQL is refused by storage (`storage.protect_delete()`),
 * so the objects can only be removed through the Storage API. A deletion that
 * stopped at the trigger would leave files in the bucket whose path still begins
 * with the user id of the person who just asked to be removed.
 *
 * So the order is: delete the account, which fires the trigger and produces the
 * list of paths; remove those objects; then delete the queue rows. Reading the
 * queue after the delete is what makes the list authoritative rather than
 * reconstructed — a path list built before the delete can miss an object written
 * in between.
 *
 * The account is already gone if this throws partway through. That is reported
 * as an internal error rather than being retried, because the account is gone and
 * the queue row is precisely the record that makes the leftover recoverable.
 * Failing loudly here is what stops the gap being silent; the alternative, a
 * success response while bytes remain under the person's id, is worse.
 *
 * Does not promise the media is gone. It reports what was removed, what could not
 * be, and what is still queued, so the caller is never told a clean result that
 * the bucket does not agree with.
 */
export async function deleteAccount(userId: string): Promise<AccountDeletionResult> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(userId);

  if (error) {
    // The provider's message names internal objects, so it is logged rather than
    // returned. Reaching this means the trigger did not run, because the trigger
    // runs inside the same delete.
    logger.error('Account deletion failed', { userId, reason: error.message });
    throw AppError.internal('The account could not be deleted.');
  }

  const queued = await db
    .select({ id: orphanedProofMedia.id, bucket: orphanedProofMedia.bucket, path: orphanedProofMedia.path })
    .from(orphanedProofMedia)
    .where(
      // Matched on the path prefix rather than through `work_proof_id`, which the
      // delete has already nulled by way of the proof row. The prefix is the
      // uploader's id by construction, so it is the one part of the path that
      // still identifies which account this belongs to.
      like(orphanedProofMedia.path, `${userId}/%`),
    );

  if (queued.length === 0) {
    return { mediaRemoved: 0, mediaPending: 0 };
  }

  // Grouped by bucket because the recorded bucket is read back from
  // `storage.objects` and is not guaranteed to be the configured one.
  const byBucket = new Map<string, string[]>();
  for (const row of queued) {
    const paths = byBucket.get(row.bucket) ?? [];
    paths.push(row.path);
    byBucket.set(row.bucket, paths);
  }

  const removed = new Set<string>();
  for (const [bucket, paths] of byBucket) {
    const outcome = await supabaseAdmin.storage.from(bucket).remove(paths);
    if (outcome.error) {
      logger.error('Could not remove media for a deleted account', {
        userId,
        bucket,
        reason: outcome.error.message,
        pathCount: paths.length,
      });
      continue;
    }
    for (const path of paths) removed.add(path);
  }

  if (removed.size > 0) {
    // Only the drained rows are deleted. A row whose object is still stored is
    // the record that says so, and deleting it would turn a visible backlog into
    // an invisible leak.
    await db.delete(orphanedProofMedia).where(inArray(orphanedProofMedia.path, [...removed]));
  }

  if (removed.size !== queued.length) {
    logger.error('Media remains queued after an account deletion', {
      userId,
      queued: queued.length,
      removed: removed.size,
    });
  }

  return { mediaRemoved: removed.size, mediaPending: queued.length - removed.size };
}

/**
 * Reads the application profile for the authenticated caller.
 *
 * Scoped to the caller's own row, so `locationGps` being returned is the caller
 * reading their own location rather than anyone else's. It is included because an
 * interface has to be able to show and prefill what the user previously entered, and
 * the alternative would be a second write-only field with no way to read it back.
 * Distance is still computed by the search service, which returns kilometres and
 * never a coordinate belonging to a candidate.
 */
export async function getProfile(userId: string): Promise<ProfileResponse> {
  const rows = await db
    .select({
      id: users.id,
      role: users.role,
      fullName: profiles.fullName,
      locationCity: profiles.locationCity,
      locationGps: profiles.locationGps,
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

/**
 * Updates the caller's own profile, creating the row if it is not there yet.
 *
 * Scoped by `user_id = caller` in the statement itself rather than by reading the
 * row first and then writing it. A read-then-write would leave a window in which a
 * concurrent request could change the row and be overwritten by this one.
 *
 * The upsert is not incidental. `public.users` rows are created by the
 * `on_auth_user_created` database trigger, but `public.profiles` rows are created
 * by this module's registration path. An account created any other way, through the
 * service-role API, an import, or the Supabase dashboard, therefore has a `users`
 * row and no `profiles` row. That is precisely how an administrator is provisioned,
 * so an admin provisioned that way could not set an organization name or a location
 * at all, and both reads and writes on the profile failed for them. Creating the row
 * on demand is narrower than moving the insert into a trigger and needs no schema
 * change, so it does not disturb the accounts that already have one.
 *
 * Only the columns the caller actually supplied are written. Spreading the whole
 * input across the write would set `undefined` over every untouched column, so a
 * request that sets only a name would silently erase the location.
 */
export async function updateProfile(userId: string, input: UpdateProfileInput) {
  const patch: Partial<typeof profiles.$inferInsert> = {};
  if (input.fullName !== undefined) patch.fullName = input.fullName;
  // `null` here is meaningful and distinct from absent: it is how a worker stops
  // sharing a location and returns to the "unlocatable" state that the search
  // treats as unknown rather than disqualifying.
  if (input.locationGps !== undefined) patch.locationGps = input.locationGps;
  if (input.organizationName !== undefined) patch.organizationName = input.organizationName;

  const written = await db
    .insert(profiles)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: profiles.userId, set: patch })
    .returning({
      fullName: profiles.fullName,
      locationCity: profiles.locationCity,
      organizationName: profiles.organizationName,
      avatarUrl: profiles.avatarUrl,
    });

  const row = written[0];
  if (!row) {
    // Reachable only if the account itself is missing, since the insert would
    // otherwise fail on the foreign key. Reporting success on a write that touched
    // nothing would be worse than refusing.
    throw AppError.notFound('That account was not found.');
  }
  return row;
}
