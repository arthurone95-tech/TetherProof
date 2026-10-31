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
import { isAdministrator, listCapabilities } from '../capabilities/service.js';
import { confirmationCallbackUrl } from '../../lib/redirect.js';
import { generatePublicSlug } from '../../lib/slug.js';
import {
  createSignedAvatarUrl,
  deleteProfileAvatar,
  uploadProfileAvatar,
} from '../../lib/storage.js';
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

/**
 * Shapes a Supabase user into the public auth contract.
 *
 * Administrator comes from the server-controlled claim, because that is the only place it
 * is read from and the only way it can ever be true. Capabilities are not read here — a
 * Supabase user object carries none, and a capability that came from the token would be a
 * capability the database had not agreed to.
 */
function toAuthUser(user: {
  id: string;
  email?: string | null;
  phone?: string | null;
  app_metadata?: Record<string, unknown>;
}): AuthUser {
  return {
    id: user.id,
    capabilities: [],
    isAdmin: readRoleClaim(user.app_metadata?.role) === 'admin',
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
 * `redirectOrigin` becomes the `redirect_to` on the link inside an email, so the
 * person tapping it comes back to the application they signed up on rather than
 * to the fixed Site URL configured in the Supabase dashboard. It is accepted only
 * for email: an SMS carries a code, not a link, and there is nowhere for a
 * redirect to go.
 *
 * Never throws. A provider outage must not fail registration, and the caller can
 * always retry through `POST /auth/confirm/request`.
 */
async function deliverCode(
  channel: Channel,
  value: string,
  redirectOrigin?: string,
): Promise<boolean> {
  const target = channel === 'email' ? { email: value } : { phone: value };

  const emailRedirectTo =
    channel === 'email' && redirectOrigin ? confirmationCallbackUrl(redirectOrigin) : undefined;

  if (emailRedirectTo) {
    // Logged because it is the one value in this flow that decides where a
    // session-bearing link is sent, and "which address did that link point at"
    // was previously unanswerable without an inbox.
    logger.info('Confirmation link will return to the supplied origin', {
      channel,
      origin: redirectOrigin,
    });
  }

  const { error } = await supabaseAuth.auth.signInWithOtp({
    ...target,
    options: {
      shouldCreateUser: false,
      ...(emailRedirectTo ? { emailRedirectTo } : {}),
    },
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
  const { data, error } = await supabaseAdmin.auth.admin.createUser({
    email: input.email ?? undefined,
    phone: input.phoneNumber ?? undefined,
    password: input.password,
    // `user_metadata` is editable by the account holder, so it never carries
    // authorization decisions.
    user_metadata: input.fullName ? { full_name: input.fullName } : {},
    // No role claim is written any more. Migration `0012` made capabilities a set granted
    // after signup, and asking a new account to pick one here is the first fork this
    // design exists to remove: whichever was picked first would be the account's only role
    // and the rest would need a second account. The `on_auth_user_created` trigger grants a
    // capability from this claim when one is present, so an administrator provisioning an
    // account still works exactly as before.
    app_metadata: {},
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

  // A new account starts with no capabilities at all, and its dashboard offers the four it
  // could have. `worker` is one activation away, so an account is never stranded.
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
    delivered: await deliverCode(channel, destination, input.redirectOrigin),
  };

  return {
    user: {
      id: data.user.id,
      // A signup grants nothing. The account exists, and the dashboard offers the four
      // capabilities it could have. This is the whole reason registration stopped asking
      // for a role: the first role chosen would have been the only one.
      capabilities: await listCapabilities(data.user.id),
      isAdmin: false,
      email: data.user.email ?? null,
      phone: data.user.phone ?? null,
    },
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
    delivered: await deliverCode(channel, destination, input.redirectOrigin),
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
 * What a person is told when the identity provider could not answer at all.
 *
 * Deliberately not a statement about their credentials: see `login` for why the
 * two cases must not share a message. Points at the sign-in code as the way
 * forward, because that path does not depend on the password being remembered
 * correctly and does not depend on this one request succeeding.
 */
const SIGN_IN_UNAVAILABLE =
  'We could not sign you in just now. Check your connection and try again, or use a sign-in code instead.';

/**
 * Verifies credentials through Supabase Auth.
 *
 * The Supabase message is intentionally not forwarded, so an attacker cannot
 * use the response to learn whether a phone number or email is registered.
 *
 * Every provider error used to become `Incorrect sign-in details.`, which was
 * false in the case that mattered most: Supabase reports a rejected password and
 * a network it could not reach through the same field, so a person offline, or
 * behind a captive portal, was told their password was wrong and changed it —
 * the one action that turns a temporary problem into a real one. So only a
 * definitive verdict is answered with a credential refusal; a provider that
 * simply could not decide is answered as a service that could not decide.
 *
 * There are three definitive verdicts, and they all read identically: the
 * credentials did not match, the address is not registered, and the account
 * exists but is not confirmed yet. `email_not_confirmed` and
 * `phone_not_confirmed` sit in the same bucket as `invalid_credentials`
 * because they are the one case an attacker would otherwise exploit — a
 * refusal that distinguished an unconfirmed account from an unknown one would
 * turn the sign-in answer into an account-enumeration oracle, which is the
 * very thing this endpoint is written to prevent. Every other provider code is
 * logged rather than branched on.
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

  if (error) {
    if (
      error.code === 'invalid_credentials' ||
      // A definitive verdict that the account exists but has not been confirmed
      // cannot be answered differently from "no such account" — the two must
      // stay indistinguishable or the endpoint betrays which addresses are
      // registered and waiting to be confirmed.
      error.code === 'email_not_confirmed' ||
      error.code === 'phone_not_confirmed'
    ) {
      throw AppError.unauthorized('Incorrect sign-in details.');
    }
    logger.warn('[auth] sign-in was not answered by the identity provider', {
      code: error.code,
      status: error.status,
      message: error.message,
    });
    throw AppError.serviceUnavailable(SIGN_IN_UNAVAILABLE);
  }

  if (!data.user || !data.session) {
    // No complaint from the provider, yet nothing to sign in with: the request was
    // answered, just not with a verdict. Treated the same as an unanswered one,
    // because claiming the credentials were refused would be inventing a fact.
    logger.warn('[auth] sign-in returned no session and no error', {
      user: Boolean(data.user),
      session: Boolean(data.session),
    });
    throw AppError.serviceUnavailable(SIGN_IN_UNAVAILABLE);
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
  // The profile image path must be captured before the delete, because the same
  // trigger that records proof objects also scrubs every `profiles` column —
  // reading the path afterwards would always see null. Unlike proof media, the
  // avatar object is never queued in `orphaned_proof_media`, so keeping it under
  // the caller's id means it survives them; it is removed explicitly below.
  const [avatarRow] = await db
    .select({ path: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);
  const avatarPath = avatarRow?.path ?? null;

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

  let avatarRemoved = 0;
  let avatarPending = 0;
  if (avatarPath) {
    // Removed here rather than through the queue: the path was captured before
    // the delete, so it still points at this account's photo.
    if (await deleteProfileAvatar(avatarPath)) {
      avatarRemoved += 1;
    } else {
      avatarPending += 1;
    }
  }

  if (queued.length === 0) {
    return { mediaRemoved: avatarRemoved, mediaPending: avatarPending };
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

  return {
    mediaRemoved: removed.size + avatarRemoved,
    mediaPending: queued.length - removed.size + avatarPending,
  };
}

/**
 * Turns a stored avatar path into a short-lived URL for the response.
 *
 * A missing or unreadable object must never break the profile read: the app
 * layout fetches the profile on every page and a failure there redirects the
 * user to sign in. Any storage problem therefore degrades to `null` — the same
 * value an account without a photo returns — instead of throwing.
 */
async function signedAvatarUrl(path: string | null): Promise<string | null> {
  if (!path) {
    return null;
  }
  try {
    return await createSignedAvatarUrl(path);
  } catch {
    return null;
  }
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
      fullName: profiles.fullName,
      locationCity: profiles.locationCity,
      locationGps: profiles.locationGps,
      organizationName: profiles.organizationName,
      avatarUrl: profiles.avatarUrl,
      discoverable: profiles.discoverable,
      showNameOnVerificationLink: profiles.showNameOnVerificationLink,
      publicProfile: profiles.publicProfile,
      publicSlug: profiles.publicSlug,
      invitationPreference: profiles.invitationPreference,
      showLinksOnProfile: profiles.showLinksOnProfile,
    })
    .from(users)
    .leftJoin(profiles, eq(profiles.userId, users.id))
    .where(eq(users.id, userId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw AppError.notFound('Profile not found.');
  }

  // The capability set, and the administrator flag, are read separately from the profile
  // row. They are different questions about the same account — what it may do, and who it
  // is — and joining them would mean duplicating one capability into a row per request.
  const [capabilities, isAdmin] = await Promise.all([
    listCapabilities(userId),
    isAdministrator(userId),
  ]);

  // A profile row may not exist for an account provisioned outside registration;
  // the privacy defaults it would carry are shown, not an error.
  return {
    ...row,
    capabilities,
    isAdmin,
    discoverable: row.discoverable ?? true,
    showNameOnVerificationLink: row.showNameOnVerificationLink ?? true,
    publicProfile: row.publicProfile ?? false,
    publicSlug: row.publicSlug ?? null,
    invitationPreference: row.invitationPreference ?? 'all',
    showLinksOnProfile: row.showLinksOnProfile ?? true,
    avatarUrl: await signedAvatarUrl(row.avatarUrl),
  };
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
  if (input.discoverable !== undefined) patch.discoverable = input.discoverable;
  if (input.showNameOnVerificationLink !== undefined) {
    patch.showNameOnVerificationLink = input.showNameOnVerificationLink;
  }
  if (input.showLinksOnProfile !== undefined) {
    patch.showLinksOnProfile = input.showLinksOnProfile;
  }
  if (input.invitationPreference !== undefined) {
    patch.invitationPreference = input.invitationPreference;
  }

  // Turning the shareable page on is a two-part change: the flag and the slug.
  // The slug is generated once, in this write, so a worker cannot pick one (a
  // guessable address would make pages enumerable) and every page has an
  // address the moment it is enabled. Turning the page off clears both, so no
  // disabled page litters an address that 404s.
  if (input.publicProfile !== undefined) {
    if (input.publicProfile) {
      const [current] = await db
        .select({ publicSlug: profiles.publicSlug })
        .from(profiles)
        .where(eq(profiles.userId, userId))
        .limit(1);
      patch.publicProfile = true;
      patch.publicSlug = current?.publicSlug ?? generatePublicSlug();
    } else {
      patch.publicProfile = false;
      patch.publicSlug = null;
    }
  }

  const written = await db
    .insert(profiles)
    .values({ userId, ...patch })
    .onConflictDoUpdate({ target: profiles.userId, set: patch })
    .returning({
      fullName: profiles.fullName,
      locationCity: profiles.locationCity,
      organizationName: profiles.organizationName,
      avatarUrl: profiles.avatarUrl,
      discoverable: profiles.discoverable,
      showNameOnVerificationLink: profiles.showNameOnVerificationLink,
      publicProfile: profiles.publicProfile,
      publicSlug: profiles.publicSlug,
      invitationPreference: profiles.invitationPreference,
      showLinksOnProfile: profiles.showLinksOnProfile,
    });

  const row = written[0];
  if (!row) {
    // Reachable only if the account itself is missing, since the insert would
    // otherwise fail on the foreign key. Reporting success on a write that touched
    // nothing would be worse than refusing.
    throw AppError.notFound('That account was not found.');
  }
  return {
    ...row,
    discoverable: row.discoverable ?? true,
    showNameOnVerificationLink: row.showNameOnVerificationLink ?? true,
    publicProfile: row.publicProfile ?? false,
    publicSlug: row.publicSlug ?? null,
    invitationPreference: row.invitationPreference ?? 'all',
    showLinksOnProfile: row.showLinksOnProfile ?? true,
    avatarUrl: await signedAvatarUrl(row.avatarUrl),
  };
}

/**
 * Stores a new profile image and retires the previous one.
 *
 * The bytes are scrubbed of location metadata by the storage helper before they
 * are stored, and the object path is a random UUID the caller cannot influence,
 * the same guarantees the proof upload makes. Only this endpoint may write the
 * column, so a client-supplied avatar URL can never be rendered.
 *
 * The visible swap is one-way: the profile row is pointed at the new object
 * first, and only the object the row no longer references is deleted. A failure
 * between the two leaves the new object stored but unreferenced, never a profile
 * whose photo is gone, which is why the write happens before the delete.
 */
export async function updateAvatar(
  userId: string,
  file: { buffer: Buffer; contentType: string; size: number },
): Promise<{ avatarUrl: string | null }> {
  const [current] = await db
    .select({ path: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  const stored = await uploadProfileAvatar(userId, file);

  await db
    .insert(profiles)
    .values({ userId, avatarUrl: stored.path })
    .onConflictDoUpdate({ target: profiles.userId, set: { avatarUrl: stored.path } });

  if (current?.path) {
    // No longer referenced by the row, so at worst this orphans a file; the row
    // must never point at a photo the user replaced. Failure is logged inside.
    await deleteProfileAvatar(current.path);
  }

  return { avatarUrl: await signedAvatarUrl(stored.path) };
}

/**
 * Removes the caller's profile image, if there is one.
 *
 * Idempotent, like the rest of account deletion: removing a photo that was
 * already removed answers success with `avatarUrl: null`. The row is cleared
 * before the object is deleted so a removal that fails partway never leaves the
 * profile pointing at a photo its owner asked to delete.
 */
export async function removeAvatar(userId: string): Promise<{ avatarUrl: null }> {
  const [current] = await db
    .select({ path: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.userId, userId))
    .limit(1);

  await db
    .insert(profiles)
    .values({ userId, avatarUrl: null })
    .onConflictDoUpdate({ target: profiles.userId, set: { avatarUrl: null } });

  if (current?.path) {
    await deleteProfileAvatar(current.path);
  }

  return { avatarUrl: null };
}
