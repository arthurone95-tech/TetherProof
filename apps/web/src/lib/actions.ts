'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { PROOF_REVIEW_OUTCOMES, passwordProblems } from '@tetherproof/shared';
import type {
  AccountDeletionResult,
  AuthResponse,
  AuthSession,
  ConfirmationChallenge,
  ProofUpdateResponse,
  SkillLevel,
  UpdateProofInput,
  UserCapability,
  VerificationResendResponse,
} from '@tetherproof/shared';
import { ApiRequestError, isCredentialRefusal } from './api-error';
import type {
  AuthCallbackResult,
  AppealState,
  CapabilityState,
  FormState,
  MilestoneState,
  ProofEditState,
  ProofFormState,
  ReviewState,
} from './form-state';
import { formErrorFor } from './form-state';
import { homeFor } from './navigation';
import { apiPublic, apiServer, apiServerForm, currentProfile } from './server/api';
import { isUserCapability, writeStoredRole } from './server/active-role';
import { WORKSPACES } from './navigation';
import { currentOrigin } from './server/origin';
import { clearSession, refreshSession, writeSession } from './server/session';
import { createClient as createSupabaseServerClient } from './supabase/server';

/**
 * Result of a form submission.
 *
 * Re-exported as a type so callers can import it from here alongside the actions.
 * `EMPTY_FORM` lives in `lib/form-state.ts` and cannot be re-exported: a
 * `'use server'` module may only export async functions.
 */
export type { FormState } from './form-state';

function messageFor(error: unknown, fallback: string): string {
  if (error instanceof ApiRequestError) return error.message;
  // Never forward an unexpected error's own text: it may describe the database or
  // the network rather than anything the user can act on.
  return fallback;
}

/**
 * Where each role belongs after signing in.
 *
 * The mapping itself lives in `lib/navigation.ts` because the header and the
 * redirects have to agree: a sign-in that lands on `/invites` while the nav
 * points at `/dashboard` would be two answers to one question.
 */
function landingFor(input: { capabilities: readonly UserCapability[]; isAdmin?: boolean }): string {
  return homeFor(input);
}

export async function signIn(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');

  if (!email) return { error: 'Enter your email address.', field: 'email' };
  if (!password) return { error: 'Enter your password.', field: 'password' };

  try {
    const result = await apiPublic<AuthResponse>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (result.session) await writeSession(result.session);
    redirect(landingFor(result.user));
  } catch (error) {
    if (isRedirect(error)) throw error;
    /**
     * Only a refused password is reported against the password box.
     *
     * This used to name the field whatever went wrong, so a dropped connection —
     * or an API that was restarting, or a rate limit — put "we could not sign you
     * in" directly under the password box. Read from the side, that is a claim
     * about the password, and the obvious response to it is to retype the
     * password. A form-level message leaves the fields alone and says what
     * actually happened.
     */
    const failure = formErrorFor(error, 'We could not sign you in. Please try again.');
    return isCredentialRefusal(error) ? { ...failure, field: 'password' } : { error: failure.error };
  }
}

export async function registerAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const fullName = String(formData.get('fullName') ?? '').trim();
  // The role field is no longer read. Kept as a named absence rather than deleted so the
// reason is next to the code that used to need it: a signup asks for no role, and the
// capabilities are chosen on the dashboard afterwards.

  if (!email) return { error: 'Enter your email address.', field: 'email' };
  if (fullName.length === 0) return { error: 'Enter your name.', field: 'fullName' };

  /**
   * The API's own password rules, checked before spending the request.
   *
   * Same function, same messages, so this cannot disagree with `registerSchema`.
   * It used to check nothing, and every refusal came back as the API's
   * request-level sentence — `Request body failed validation.` — with the reason
   * discarded, which is how a person was told their password was wrong without
   * being told what was wrong with it.
   *
   * Worth doing here as well as in the API because `/auth/register` is rate limited
   * to ten attempts per fifteen minutes, and a refused password still counts as an
   * attempt. Failing locally costs nothing; failing remotely eventually costs the
   * person the ability to try at all.
   */
  const problems = passwordProblems(password);
  if (problems.length > 0) return { error: problems[0], field: 'password' };

  /**
   * The two password boxes must hold the same thing.
   *
   * Checked here rather than only in the browser because the browser is not a
   * place a rule can be enforced: anything a form can skip, a request can skip,
   * and an account created from a mistyped password locks the person out of the
   * address they just gave. Compared after the policy check rather than before
   * it, so a password that is both short and unmatched is told it is short — that
   * is the first thing to fix, and the second only matters once it holds.
   *
   * A field left empty reads as a mismatch, which is what it is: the two answers
   * differ, and the form asks for both.
   */
  if (confirmPassword !== password) {
    return { error: 'Those passwords do not match.', field: 'confirmPassword' };
  }

  /**
   * Where a confirmation link should bring whoever taps it.
   *
   * Taken from this request rather than written down in configuration, so the
   * link follows whatever port the server actually started on. A fixed port was
   * the whole defect: the link went to `http://localhost:3000` while the
   * application was on 3001, and the session in the link was delivered to a
   * different application entirely. Omitted when it cannot be determined, and
   * the API then falls back to its own configured origin.
   */
  const redirectOrigin = await currentOrigin();

  try {
    const result = await apiPublic<AuthResponse>('/auth/register', {
      method: 'POST',
      body: {
        email,
        password,
        fullName,
        // No role is sent. Migration `0012` makes capabilities a set granted after signup,
        // and the endpoint ignores this field for compatibility with a client that has
        // not been redeployed yet — so a stale client keeps working without being able to
        // grant anything.
        ...(redirectOrigin ? { redirectOrigin } : {}),
      },
    });

    if (result.session) {
      // An account created while the provider auto-confirms arrives signed in.
      await writeSession(result.session);
      redirect(landingFor(result.user));
    }

    // Otherwise the account exists but must prove ownership of its channel first.
    // The destination is returned masked by the API, which is what makes it safe to
    // show here: the full address is never echoed back to the browser.
    return { done: true, sentTo: result.confirmation?.destination ?? 'the address you signed up with' };
  } catch (error) {
    if (isRedirect(error)) throw error;
    // Field-level if the API gave any, so an email it refuses lands on the email
    // input. The request-level message remains the fallback for anything else.
    return formErrorFor(error, 'We could not create that account. Please try again.');
  }
}

/**
 * Asks for a fresh one-time sign-in code.
 *
 * Returns the masked destination on success. The API answers `202` whether or not
 * the account exists, so nothing here distinguishes the two, and the masked address
 * is the only part of it safe to show.
 */
export async function requestCode(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  if (!email) return { error: 'Enter your email address.', field: 'email' };

  const redirectOrigin = await currentOrigin();

  try {
    const challenge = await apiPublic<ConfirmationChallenge>('/auth/confirm/request', {
      method: 'POST',
      body: { email, ...(redirectOrigin ? { redirectOrigin } : {}) },
    });
    return { done: true, sentTo: challenge.destination };
  } catch (error) {
    return { error: messageFor(error, 'We could not send a code. Please try again.') };
  }
}

/**
 * Exchanges a one-time code for a session.
 *
 * The API answers the same way for an unknown account, a wrong code, and an expired
 * one, so this reports a single generic message and cannot be used to find out which
 * addresses are registered.
 */
export async function confirmWithCode(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const code = String(formData.get('code') ?? '').trim();

  if (!email) return { error: 'Enter your email address.', field: 'email' };
  if (!code) return { error: 'Enter the code you received.', field: 'code' };

  try {
    const result = await apiPublic<AuthResponse>('/auth/confirm', {
      method: 'POST',
      body: { email, token: code },
    });
    if (result.session) await writeSession(result.session);
    redirect(landingFor(result.user));
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: messageFor(error, 'That code could not be used. Request a new one and try again.') };
  }
}

export async function signOut(): Promise<void> {
  await clearSession();
  redirect('/');
}

/**
 * What a person is told when a confirmation link cannot become a session.
 *
 * One sentence for every failure on purpose. Whoever is reading this tapped a
 * link in an email; separating an expired token from a replayed one would say
 * something about an account they may not own, and would not change what they
 * should do next, which is ask for a fresh code.
 */
const CALLBACK_FAILED = 'That sign-in link could not be used. Request a new code and try again.';

/**
 * Turns the credentials Supabase placed in a confirmation link into the
 * application's own session.
 *
 * The link arrives as a URL fragment — `#access_token=...&refresh_token=...` —
 * which the browser never sends to a server, so `/auth/callback` reads it in the
 * browser and passes the refresh token here. Nothing in this action takes that
 * token on trust: it is exchanged with Supabase, and only Supabase's answer is
 * stored. A token the client merely asserted would otherwise be enough to make
 * the application treat somebody as signed in.
 *
 * Answers rather than redirecting, so a refusal can be reported on the page the
 * person is already looking at instead of becoming Next.js's error screen.
 */
export async function completeAuthCallback(refreshToken: string): Promise<AuthCallbackResult> {
  if (typeof refreshToken !== 'string' || refreshToken.length === 0 || refreshToken.length > 500) {
    return { ok: false, error: CALLBACK_FAILED };
  }

  const session = await refreshSession(refreshToken);
  if (!session) return { ok: false, error: CALLBACK_FAILED };

  if (!(await writeSession(session))) return { ok: false, error: CALLBACK_FAILED };

  return landingForCurrentProfile();
}

/**
 * Completes a confirmation link Supabase sent as `?code=...` rather than as a
 * fragment.
 *
 * That is the PKCE shape, which is what this application's own Supabase clients
 * speak: they store the code verifier in the reader's cookies when an
 * authentication request is made through them, and `exchangeCodeForSession` is
 * the Supabase helper that pairs that verifier with the code. When the code came
 * from somewhere else there is no verifier to pair with it and the exchange is
 * refused — correctly, since accepting it would defeat the point of the pairing —
 * and that refusal is reported rather than papered over.
 */
export async function completeAuthFromCode(code: string): Promise<AuthCallbackResult> {
  if (typeof code !== 'string' || code.length === 0 || code.length > 2000) {
    return { ok: false, error: CALLBACK_FAILED };
  }

  let session: AuthSession | null = null;
  try {
    const supabase = await createSupabaseServerClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    const exchanged = error ? null : data.session;
    session = exchanged
      ? {
          accessToken: exchanged.access_token,
          refreshToken: exchanged.refresh_token,
          expiresIn: exchanged.expires_in ?? 3600,
        }
      : null;
  } catch {
    session = null;
  }

  if (!session) return { ok: false, error: CALLBACK_FAILED };
  if (!(await writeSession(session))) return { ok: false, error: CALLBACK_FAILED };

  return landingForCurrentProfile();
}

/**
 * Reports where the just-signed-in account belongs.
 *
 * The role is read from the API rather than from the token, because the API is
 * what will authorize every page opened next: sending somebody to a home their
 * own API disagrees with only produces an error screen one click later. An
 * account the API will not recognize is not signed in, so the cookie written a
 * moment ago is cleared rather than left to fail on the following request.
 */
async function landingForCurrentProfile(): Promise<AuthCallbackResult> {
  const profile = await currentProfile().catch(() => null);
  if (!profile) {
    await clearSession();
    return { ok: false, error: CALLBACK_FAILED };
  }

  return { ok: true, landing: landingFor(profile) };
}

/**
 * Deletes the signed-in member's account.
 *
 * The session is cleared only after the API confirms the deletion, so a failure
 * leaves the member signed in and able to try again rather than logged out of an
 * account that still exists.
 *
 * Redirects rather than returning a message, because there is no page left to show
 * a result on. The API's own counts of removed and pending media are handed to the
 * landing page instead of being discarded: a deletion that left files behind is
 * worth saying plainly rather than reporting as a clean success.
 */
export async function deleteAccount(): Promise<void> {
  let result: AccountDeletionResult;
  try {
    result = await apiServer<AccountDeletionResult>('/auth/account', { method: 'DELETE' });
  } catch (error) {
    redirect(`/settings/account?error=${encodeURIComponent(messageFor(error, 'We could not delete your account. Please try again.'))}`);
  }

  await clearSession();

  const params = new URLSearchParams({ deleted: '1' });
  if (result.mediaPending > 0) params.set('pending', String(result.mediaPending));
  redirect(`/?${params.toString()}`);
}

/**
 * Saves the name, the organization name, and the location distances are measured from.
 *
 * All three live on the same profile row and are saved in one request because the
 * interface shows them in one place. Which of them the form actually carries is read
 * from the form itself, so the same action serves the employer's details card and the
 * profile page without either having to declare what the other is allowed to change.
 *
 * The employer's half also carries what a worker reads on an invitation: the name of
 * the organisation, and the origin their searches measure from.
 */
export async function saveProfile(_previous: FormState, formData: FormData): Promise<FormState> {
  const body: Record<string, unknown> = {};

  // Each field is sent only when the form actually carries it. A form that
  // omitted a field means "leave it alone", never "clear it": the employer's
  // personal card does not ask for the organization name or a search location,
  // and sending an empty value from a form that never showed the input would
  // silently wipe what another screen set. A field the form does carry is
  // handled, including an explicit clear of the location.
  if (formData.has('fullName')) {
    const fullName = String(formData.get('fullName') ?? '').trim();
    if (!fullName) return { error: 'Enter your name.', field: 'fullName' };
    body.fullName = fullName;
  }

  if (formData.has('organizationName')) {
    const organizationName = String(formData.get('organizationName') ?? '').trim();
    if (!organizationName) return { error: 'Enter your organization name.', field: 'organizationName' };
    body.organizationName = organizationName;
  }

  if (formData.has('latitude') || formData.has('longitude')) {
    const latitude = String(formData.get('latitude') ?? '').trim();
    const longitude = String(formData.get('longitude') ?? '').trim();

    // An empty pair means "no location", which is a real choice: searches then
    // run without a distance filter instead of from a stale point. One
    // coordinate alone is refused rather than filled in from the other.
    if (!latitude && !longitude) {
      body.locationGps = null;
    } else if (!latitude || !longitude) {
      return { error: 'Enter both latitude and longitude, or clear both.', field: 'latitude' };
    } else {
      const locationGps = parseCoordinatePair(latitude, longitude);
      if (!locationGps) {
        return { error: 'Enter valid coordinates, for example 5.6037 and -0.1870.', field: 'latitude' };
      }
      body.locationGps = locationGps;
    }
  }

  try {
    if (Object.keys(body).length > 0) {
      await apiServer('/auth/profile', { method: 'PATCH', body });
    }
    revalidatePath('/profile');
    revalidatePath('/roles');
    revalidatePath('/setup/worker');
    revalidatePath('/setup/training_provider');
    revalidatePath('/setup/trainee');
    revalidatePath('/employer');
    revalidatePath('/employer/organization');
    return { done: true };
  } catch (error) {
    return formErrorFor(error, 'We could not save that. Please try again.');
  }
}

/** Accepts the API's own `latitude,longitude` text, or rejects it clearly. */
function parseCoordinatePair(latitude: string, longitude: string): string | null {
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return `${lat},${lng}`;
}

/** Everything the profile-image endpoint accepts, and nothing else. */
const AVATAR_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic'];

/** Matches the API's own cap (`STORAGE_MAX_AVATAR_BYTES`, default 5 MB). */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/**
 * Sets or replaces the caller's profile image.
 *
 * The file travels as multipart for the same reason a proof does: it is the file
 * itself, not a description of one. `POST /auth/avatar` is the only writer of the
 * photo, so a picture can never arrive as a URL the client invented — the profile
 * update schema deliberately accepts no avatar URL at all.
 *
 * The type and size are checked here as well as in the API because the endpoint
 * is rate limited; spending one of the few upload attempts on a file the API was
 * always going to refuse is a worse answer than saying so before the request.
 */
export async function uploadAvatar(_previous: FormState, formData: FormData): Promise<FormState> {
  const media = formData.get('avatar_file');
  if (!(media instanceof File) || media.size === 0) {
    return { error: 'Choose a photo to upload.', field: 'avatar_file' };
  }
  if (!AVATAR_MEDIA_TYPES.includes(media.type.toLowerCase())) {
    return {
      error: 'That file type is not supported. Use a JPG, PNG, WebP or HEIC image.',
      field: 'avatar_file',
    };
  }
  if (media.size > MAX_AVATAR_BYTES) {
    return { error: 'Profile images must be smaller than 5 MB.', field: 'avatar_file' };
  }

  try {
    await apiServerForm('/auth/avatar', formData);
    revalidatePath('/profile');
    return { done: true };
  } catch (error) {
    /**
     * Field-level only when the API names one.
     *
     * The three refusals above are the file's own fault and say so. Anything
     * arriving here is the upload that did not complete — a dropped connection, a
     * size the API refused server-side — and reporting that beside the file picker
     * sends the reader hunting for a bad photo that is perfectly good. Same rule as
     * the sign-in form: a message goes next to the input only when that input is
     * what is wrong.
     */
    return formErrorFor(error, 'We could not update your photo. Please try again.');
  }
}

/**
 * Removes the caller's profile image, if there is one.
 *
 * The API answers successfully whether or not a photo existed, so this cannot
 * fail on a photo that is already gone. The page is revalidated so the read-only
 * view stops showing the removed picture.
 */
export async function removeAvatar(_previous: FormState, _formData: FormData): Promise<FormState> {
  try {
    await apiServer('/auth/avatar', { method: 'DELETE' });
    revalidatePath('/profile');
    return { done: true };
  } catch (error) {
    return { error: messageFor(error, 'We could not remove your photo. Please try again.') };
  }
}

function asPositiveInt(value: FormDataEntryValue | null, fallback: number): number {
  const parsed = Number(String(value ?? ''));
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.floor(parsed);
}

export async function createSpec(_previous: FormState, formData: FormData): Promise<FormState> {
  const requiredSkill = String(formData.get('requiredSkill') ?? '').trim();
  if (!requiredSkill) return { error: 'Enter a skill to search for.', field: 'requiredSkill' };

  try {
    await apiServer('/employers/specs', {
      method: 'POST',
      body: {
        requiredSkill,
        minProofThreshold: asPositiveInt(formData.get('minProofThreshold'), 1),
        maxDistanceKm: asPositiveInt(formData.get('maxDistanceKm'), 25),
      },
    });
    revalidatePath('/employer/search');
    revalidatePath('/employer');
    return { done: true };
  } catch (error) {
    return { error: messageFor(error, 'We could not save that search. Please try again.') };
  }
}

/**
 * Saves a worker from a search card.
 *
 * Throws rather than returning state because the caller is an optimistic toggle
 * that has already moved the star: it needs to know the write failed so it can
 * put the star back, and a returned error object would have to be checked in a
 * way a thrown error cannot be forgotten by.
 *
 * Addressed by candidate handle, never by worker id, because the id was never
 * given to the browser.
 */
export async function saveSavedWorker(candidateHandle: string, skillTag: string): Promise<void> {
  if (!candidateHandle) throw new Error('Run the search again before saving.');
  try {
    await apiServer('/employers/saved-workers', {
      method: 'POST',
      body: { candidateHandle, skillTag },
    });
    revalidatePath('/employer/search');
  } catch (error) {
    throw new Error(messageFor(error, 'That worker could not be saved. Please try again.'));
  }
}

/** Removes a saved worker. Same optimistic contract as `saveSavedWorker`. */
export async function unsaveSavedWorker(savedId: string): Promise<void> {
  if (!savedId) throw new Error('That saved worker could not be found.');
  try {
    await apiServer(`/employers/saved-workers/${encodeURIComponent(savedId)}`, {
      method: 'DELETE',
    });
    revalidatePath('/employer/search');
  } catch (error) {
    throw new Error(messageFor(error, 'That worker could not be removed. Please try again.'));
  }
}

/** Pauses or resumes a spec, or removes one that was a mistake. */
export async function changeSpec(formData: FormData): Promise<void> {
  const specId = String(formData.get('specId') ?? '');
  const intent = String(formData.get('intent') ?? '');

  const path = `/employers/specs/${encodeURIComponent(specId)}`;
  try {
    if (intent === 'delete') {
      await apiServer(path, { method: 'DELETE' });
    } else if (intent === 'edit') {
      /*
       * Only the fields the edit form actually carries are sent, and each is
       * dropped when it is blank rather than sent as an empty string. An empty
       * value is a validation failure at the API for the skill, and for the two
       * numbers it would narrow the spec to nothing — so "left alone" has to be
       * expressed by absence, which is what the schema's optional fields mean.
       */
      const body: Record<string, unknown> = {};
      const skill = String(formData.get('requiredSkill') ?? '').trim();
      if (skill) body.requiredSkill = skill;

      const proofs = String(formData.get('minProofThreshold') ?? '').trim();
      if (proofs) body.minProofThreshold = asPositiveInt(proofs, 1);

      const radius = String(formData.get('maxDistanceKm') ?? '').trim();
      if (radius) body.maxDistanceKm = asPositiveInt(radius, 25);

      if (Object.keys(body).length === 0) {
        redirect(`/employer/search?error=${encodeURIComponent('Nothing was changed.')}`);
      }

      await apiServer(path, { method: 'PATCH', body });
    } else {
      await apiServer(path, { method: 'PATCH', body: { isActive: intent === 'activate' } });
    }
  } catch (error) {
    // These controls have no field to attach a message to, so the reason is
    // re-thrown as a redirect the page can render.
    redirect(`/employer/search?error=${encodeURIComponent(messageFor(error, 'That change did not apply.'))}`);
  }

  revalidatePath('/employer/search');
  revalidatePath('/employer');
}

/**
 * Records an administrator's decision on an employer account.
 *
 * The note is capped by the API's own schema, so this forwards a trimmed value
 * and lets the service store it. `pending` is accepted so a mistaken decision can
 * be put back in the queue rather than being final by accident.
 */
export async function decideEmployerApproval(
  _previous: FormState,
  formData: FormData,
): Promise<FormState> {
  const employerId = String(formData.get('employerId') ?? '');
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
    return { error: 'Choose approve or reject.' };
  }

  try {
    await apiServer(`/admin/employers/${encodeURIComponent(employerId)}/approval`, {
      method: 'POST',
      body: note ? { status, note } : { status },
    });
    revalidatePath('/admin');
    return { done: true };
  } catch (error) {
    return formErrorFor(error, 'We could not record that decision. Please try again.');
  }
}

export async function sendOffer(_previous: FormState, formData: FormData): Promise<FormState> {
  const candidateHandle = String(formData.get('candidateHandle') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  try {
    await apiServer('/employers/offers', {
      method: 'POST',
      body: note ? { candidateHandle, note } : { candidateHandle },
    });
    revalidatePath('/employer/candidates');
    revalidatePath('/employer');
    return { done: true };
  } catch (error) {
    return { error: messageFor(error, 'We could not send that invitation. Please try again.') };
  }
}

/**
 * Records which role the person chose, then sends them there.
 *
 * This is a server action rather than a link because **switching has to be a real
 * transition**, not a repaint. Three things have to be true afterwards: the cookie
 * remembers it, so a refresh stays put; the account is re-read, so the navigation and the
 * header are rebuilt for that role rather than only the label changing; and the target is
 * validated, so choosing a role the account does not hold cannot mark one as active.
 *
 * Reaches setup rather than an empty workspace when the role is not configured yet. That
 * is the point of `resolveRoleDestination`: arriving at an employer workspace with no
 * approved business shows a search page that refuses every query, which reads as a fault
 * rather than as "you have not finished setting this up".
 *
 * Until that setup completes, **nothing about the current role changes** — this never
 * writes the cookie for a role it did not successfully route to a real workspace.
 */
export async function switchRole(formData: FormData): Promise<void> {
  const requested = String(formData.get('role') ?? '');
  if (!isUserCapability(requested)) redirect('/roles');

  const profile = await currentProfile();
  if (!profile) redirect('/login');

  const destination = resolveRoleDestination(requested, profile.capabilities);

  // Only a role we actually land in gets remembered. A failed or abandoned setup must
  // not overwrite the last role that worked.
  if (destination === WORKSPACES[requested].href) {
    await writeStoredRole(requested);
  }

  redirect(destination);
}

/**
 * Where choosing `role` should actually go, given what the account holds.
 *
 * A configured role goes to its workspace. One that is held but not yet configured — an
 * employer whose business is still pending review — goes to its setup page, which says so
 * and explains the wait. One that is not held at all goes to setup, because the switcher
 * lists all four and tapping one you do not have is how you find out it exists.
 */
function resolveRoleDestination(
  role: UserCapability,
  capabilities: readonly UserCapability[],
): string {
  if (!capabilities.includes(role)) return `/setup/${role}`;
  return WORKSPACES[role].href;
}

// ---------------------------------------------------------------------------
// Capabilities and businesses (migration 0012)
// ---------------------------------------------------------------------------

/**
 * Activates a capability the account does not hold.
 *
 * Whether this is allowed is decided by the server, which knows the self-service rules;
 * this action only forwards the name and reports what happened. A page that decided for
 * itself would be a second copy of a security rule, and the copy is what drifts.
 *
 * Navigating to `/capabilities` on success rather than into the new workspace: the button
 * said "activate", not "take me there", and the page is where the person can see what
 * they now hold alongside what they do not.
 */
/**
 * Records an administrator's decision on a business.
 *
 * The employer capability is granted or taken inside the same service call, so this action
 * does not need to remember to do a second thing — and cannot get it half-right, which
 * would leave a business reading "approved" that nobody can hire through.
 */
export async function decideBusinessApproval(
  _previous: CapabilityState,
  formData: FormData,
): Promise<CapabilityState> {
  const businessId = String(formData.get('businessId') ?? '');
  const status = String(formData.get('status') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  if (status !== 'approved' && status !== 'rejected' && status !== 'pending') {
    return { error: 'Choose approve or reject.' };
  }

  try {
    await apiServer(`/admin/businesses/${encodeURIComponent(businessId)}/approval`, {
      method: 'POST',
      body: note ? { status, note } : { status },
    });
    revalidatePath('/admin');
    return { done: true };
  } catch (error) {
    return { error: messageFor(error, 'We could not record that decision. Please try again.') };
  }
}

export async function activateCapability(
  _previous: CapabilityState,
  formData: FormData,
): Promise<CapabilityState> {
  const capability = String(formData.get('capability') ?? '').trim();
  if (!capability) return { error: 'That capability is not valid.' };

  try {
    await apiServer('/auth/capabilities', { method: 'POST', body: { capability } });
    revalidatePath('/capabilities');
    revalidatePath('/roles');
    revalidatePath('/dashboard');
    // The setup page decides for itself what to show from the capability it holds, so it
    // has to be re-read after a grant: it advances from the activation step to the
    // configuration step on its own. Without this the page would sit on a button for a
    // capability the account now holds, and pressing it again would be a no-op.
    revalidatePath(`/setup/${capability}`);
    return { done: true, granted: true };
  } catch (error) {
    return {
      error: messageFor(
        error,
        'That could not be activated just now. Refresh and try again.',
      ),
    };
  }
}

/**
 * Creates a business, which is how a person earns the employer capability.
 *
 * Deliberately not an activation: the business is created pending, and the capability
 * arrives when an administrator approves it. Presenting this as "activate employer" and
 * then waiting for review would be the kind of promise the page above refuses to make.
 */
export async function createBusiness(
  _previous: CapabilityState,
  formData: FormData,
): Promise<CapabilityState> {
  const name = String(formData.get('name') ?? '').trim();
  if (name.length < 2) return { error: 'Give the business a name of at least 2 characters.', field: 'name' };

  try {
    await apiServer('/businesses', { method: 'POST', body: { name } });
    revalidatePath('/capabilities');
    revalidatePath('/businesses');
    return { done: true, granted: false };
  } catch (error) {
    return { error: messageFor(error, 'The business could not be created. Please try again.') };
  }
}

// ---------------------------------------------------------------------------
// Training providers (doc/02 Module 4)
// ---------------------------------------------------------------------------

/**
 * Creates or rotates the institute's enrolment code.
 *
 * The returned code is the last time it exists anywhere — only a digest is kept by
 * the API — so it is returned rather than redirected with, and the roster page shows
 * it once with a copy control. Losing it means generating another, which is why
 * rotation is a normal action rather than a recovery one.
 */
export async function generateEnrolmentCode(_previous: MilestoneState): Promise<MilestoneState> {
  try {
    const created = await apiServer<{ enrolmentCode: string }>('/trainers/roster/code', {
      method: 'POST',
    });
    revalidatePath('/trainer/roster');
    return { done: true, enrolmentCode: created.enrolmentCode };
  } catch (error) {
    return { error: messageFor(error, 'We could not create an enrolment code. Please try again.') };
  }
}

/**
 * Removes a student from the institute's roster.
 *
 * Throws rather than returning state, for the same reason `changeSpec` redirects: a
 * control with no field to attach a message to needs somewhere to put one. The
 * student's already-accepted credentials are deliberately left in place.
 */
export async function unenrolStudent(formData: FormData): Promise<void> {
  const enrolmentId = String(formData.get('enrolmentId') ?? '');
  try {
    await apiServer(`/trainers/roster/${encodeURIComponent(enrolmentId)}`, { method: 'DELETE' });
  } catch (error) {
    redirect(`/trainer/roster?error=${encodeURIComponent(messageFor(error, 'That student could not be removed.'))}`);
  }
  revalidatePath('/trainer/roster');
  revalidatePath('/trainer');
}

/**
 * Signs off on a practical for a student.
 *
 * The returned credential is `awaiting_student`, and the state says so rather than
 * reporting a finished credential: the institute has recorded a milestone, and the
 * student still has to agree to hold it. An instructor who believes the credential is
 * already theirs would be wrong about the one thing this feature is for.
 */
export async function issueMilestone(
  _previous: MilestoneState,
  formData: FormData,
): Promise<MilestoneState> {
  const enrolmentId = String(formData.get('enrolmentId') ?? '').trim();
  const skillTag = String(formData.get('skillTag') ?? '').trim();
  const milestoneTitle = String(formData.get('milestoneTitle') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim();

  if (!enrolmentId) return { error: 'Choose a student from your roster.', field: 'enrolmentId' };
  if (!skillTag) return { error: 'Enter the skill this practical covers.', field: 'skillTag' };
  if (!milestoneTitle) {
    return { error: 'Name the practical so the record says what was sat.', field: 'milestoneTitle' };
  }

  const level = asPositiveInt(formData.get('skillLevel'), 1);

  try {
    const issued = await apiServer<{
      id: string;
      studentName: string | null;
      skillTag: string;
      milestoneTitle: string;
    }>('/trainers/credentials', {
      method: 'POST',
      body: {
        enrolmentId,
        skillTag,
        milestoneTitle,
        skillLevel: Math.min(3, level),
        ...(note ? { note } : {}),
      },
    });

    revalidatePath('/trainer/credentials');
    revalidatePath('/trainer/roster');
    revalidatePath('/trainer');
    return { done: true, issued };
  } catch (error) {
    return {
      error: messageFor(error, 'We could not record that milestone. Please try again.'),
    };
  }
}

/**
 * A student redeeming their institute's enrolment code.
 *
 * The code is sent trimmed but otherwise untouched, so the normalisation that makes
 * a code tolerant of dashes and case happens in one place — the API — rather than
 * being duplicated here where the two could drift apart.
 */
export async function redeemEnrolmentCode(
  _previous: MilestoneState,
  formData: FormData,
): Promise<MilestoneState> {
  const code = String(formData.get('code') ?? '').trim();
  if (!code) return { error: 'Enter the code your institute gave you.', field: 'code' };

  try {
    const result = await apiServer<{ organizationName: string | null }>(
      '/workers/enrolment',
      { method: 'POST', body: { code } },
    );
    revalidatePath('/credentials');
    revalidatePath('/dashboard');
    return {
      done: true,
      answered: 'accepted',
      // Named on success so the student can see which institute they just joined
      // rather than being told only that it worked.
      enrolledWith: result.organizationName,
    };
  } catch (error) {
    return { error: messageFor(error, 'That enrolment code could not be used. Please try again.') };
  }
}

/**
 * A student accepting or declining an issued credential.
 *
 * The two buttons are the same action with a different intent, so they share one
 * function and differ only in what was pressed — a second form for each would be two
 * places to keep in step for no benefit.
 *
 * Accepting here means "I agree to hold this on my record". It does not add to the
 * worker's client-verified proof count, and the page it returns to says so.
 */
export async function respondToMilestone(
  _previous: MilestoneState,
  formData: FormData,
): Promise<MilestoneState> {
  const credentialId = String(formData.get('credentialId') ?? '');
  const response = String(formData.get('response') ?? '');
  if (response !== 'accepted' && response !== 'declined') {
    return { error: 'Choose accept or decline.' };
  }

  try {
    await apiServer(`/workers/credentials/${encodeURIComponent(credentialId)}`, {
      method: 'POST',
      body: { response },
    });
    revalidatePath('/credentials');
    revalidatePath('/dashboard');
    return { done: true, answered: response };
  } catch (error) {
    return { error: messageFor(error, 'We could not record your answer. Please try again.') };
  }
}

export async function respondToOffer(_previous: FormState, formData: FormData): Promise<FormState> {
  const offerId = String(formData.get('offerId') ?? '');
  const response = String(formData.get('response') ?? '');

  try {
    await apiServer(`/invites/offers/${encodeURIComponent(offerId)}/respond`, {
      method: 'POST',
      body: { response: response === 'accepted' ? 'accepted' : 'declined' },
    });
    revalidatePath('/invites');
    return { done: true };
  } catch (error) {
    return { error: messageFor(error, 'We could not record your answer. Please try again.') };
  }
}

/**
 * What the API answers one proof submission with.
 *
 * Declared here rather than imported from `apps/api`, which is a separate package
 * the web app does not depend on, and not added to `@tetherproof/shared` because
 * only this one caller reads it. The field order and meanings follow the API's
 * own `ProofSubmissionResult`.
 */
interface ProofSubmissionResult {
  proofId: string;
  skillTag: string;
  capabilityBlockId: string;
  metadataStatus: 'pending';
  scrubbed: { hadGps: boolean; hadMetadata: boolean; hadAudioTags: boolean };
  /** Returned exactly once: only its digest is stored, so it cannot be re-read. */
  verificationToken: string;
  verificationExpiresAt: string;
  verificationLinkSent: boolean;
}

const PROOF_FIELD_FOR_PATH: Record<string, NonNullable<ProofFormState['field']>> = {
  description: 'description',
  skillTag: 'skillTag',
  submissionGps: 'submissionGps',
};

/** The same mapping for the edit form, which has no verifier-phone field. */
const PROOF_EDIT_FIELD_FOR_PATH: Partial<Record<string, NonNullable<ProofEditState['field']>>> = {
  description: 'description',
  skillTag: 'skillTag',
  submissionGps: 'submissionGps',
};

/**
 * Everything storage accepts, and nothing else.
 *
 * Checked before the request goes out because `/workers/proofs` sits behind a
 * media rate limiter: spending one of a worker's few uploads per minute on a file
 * the API was always going to refuse is a worse answer than saying so here, with
 * the words matched to what the picker offered them.
 */
const PROOF_MEDIA_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'audio/mpeg',
  'audio/mp4',
  'audio/aac',
];

/**
 * Logs one completed job: the file, the words around it, and where it happened.
 *
 * The file travels as multipart. Sending it through `apiServer` would JSON-encode
 * it, producing a description of the file rather than the file, so this action
 * uses the one client that passes a `FormData` through untouched.
 *
 * Blank text fields are removed rather than sent empty. The API treats a present
 * `submissionGps` as a location that failed validation, so an empty string would
 * turn "I chose not to share where this happened" into a refusal.
 *
 * The obvious checks are repeated from the API's schema on purpose: `/workers/proofs`
 * is behind a media rate limiter, and discovering a nine-character description was
 * too short after the file has already been uploaded is a worse answer than saying
 * so before it starts.
 */
export async function submitProof(
  _previous: ProofFormState,
  formData: FormData,
): Promise<ProofFormState> {
  const description = String(formData.get('description') ?? '').trim();
  const skillTag = String(formData.get('skillTag') ?? '').trim();
  const skillLevelRaw = String(formData.get('skillLevel') ?? '').trim();

  if (description.length < 10) {
    return { error: 'Describe the work in at least 10 characters.', field: 'description' };
  }
  if (description.length > 2000) {
    return { error: 'Keep the description under 2000 characters.', field: 'description' };
  }
  if (skillTag.length < 2) {
    return { error: 'Enter the skill this work belongs to.', field: 'skillTag' };
  }
  if (skillTag.length > 160) {
    return { error: 'Keep the skill name under 160 characters.', field: 'skillTag' };
  }

  // The level is optional and its value is validated by the API; an empty box
  // simply means "entry level" there. A value that is not a level is forwarded
  // anyway so the API's own refusal, with its own wording, comes back here.
  if (skillLevelRaw) formData.set('skillLevel', skillLevelRaw);

  const media = formData.get('media_file');
  if (!(media instanceof File) || media.size === 0) {
    return { error: 'Add a photo or a recording of the work you completed.', field: 'media_file' };
  }
  if (!PROOF_MEDIA_TYPES.includes(media.type.toLowerCase())) {
    return {
      error: 'That file type is not supported. Use a JPG, PNG, WebP, HEIC, MP3, M4A or AAC file.',
      field: 'media_file',
    };
  }

  const submissionGps = String(formData.get('submissionGps') ?? '').trim();
  if (submissionGps && !/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(submissionGps)) {
    return {
      error: 'Enter coordinates as latitude, longitude — for example 5.6037,-0.1870.',
      field: 'submissionGps',
    };
  }
  if (submissionGps) {
    const parts = submissionGps.split(',');
    const latitude = Number(parts[0]);
    const longitude = Number(parts[1]);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return { error: 'Location coordinates are out of range.', field: 'submissionGps' };
    }
  }

  for (const key of ['submissionGps']) {
    const value = String(formData.get(key) ?? '').trim();
    if (value) formData.set(key, value);
    else formData.delete(key);
  }

  try {
    const result = await apiServerForm<ProofSubmissionResult>('/workers/proofs', formData);
    // Awaited, not stringified in place: `currentOrigin` reads headers, so it
    // answers with a promise, and a promise written into a template becomes
    // `[object Promise]` — a link that looks complete and goes nowhere.
    const origin = (await currentOrigin()) ?? '';
    return {
      done: true,
      result: {
        proofId: result.proofId,
        skillTag: result.skillTag,
        verificationUrl: `${origin}/verify/${result.verificationToken}`,
        verificationLinkSent: result.verificationLinkSent,
        verificationExpiresAt: result.verificationExpiresAt,
        scrubbed: result.scrubbed,
      },
    };
  } catch (error) {
    if (error instanceof ApiRequestError) {
      const first = error.issues[0];
      if (first) return { error: first.message, field: PROOF_FIELD_FOR_PATH[first.path] };
      return { error: error.message };
    }
    return { error: 'We could not log that. Please try again.' };
  }
}

/**
 * Edits one of the caller's log entries, within the freeze rule.
 *
 * The API decides whether an edit is still allowed — a log freezes once its
 * confirmation link has actually been sent out, or once it has been confirmed —
 * so this action only shapes what was typed and lets the API's refusal, with
 * its own wording, come back to the form.
 *
 * The location boxes are seeded from the stored pair, so an empty pair is a
 * deliberate clear rather than an omission; the API's `submissionGps: null`
 * removes the stored location.
 */
export async function updateProof(
  _previous: ProofEditState,
  formData: FormData,
): Promise<ProofEditState> {
  const proofId = String(formData.get('proofId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const skillTag = String(formData.get('skillTag') ?? '').trim();
  const skillLevelRaw = String(formData.get('skillLevel') ?? '').trim();
  const draftLat = String(formData.get('lat') ?? '').trim();
  const draftLng = String(formData.get('lng') ?? '').trim();

  if (description.length < 10) {
    return { error: 'Describe the work in at least 10 characters.', field: 'description' };
  }
  if (description.length > 2000) {
    return { error: 'Keep the description under 2000 characters.', field: 'description' };
  }
  if (skillTag.length < 2) {
    return { error: 'Enter the skill this work belongs to.', field: 'skillTag' };
  }
  if (skillTag.length > 160) {
    return { error: 'Keep the skill name under 160 characters.', field: 'skillTag' };
  }

  const changes: UpdateProofInput = { description, skillTag };
  if (skillLevelRaw) {
    const level = Number(skillLevelRaw);
    if (!Number.isInteger(level) || level < 1 || level > 3) {
      return { error: 'Choose a level for this skill: entry, skilled, or advanced.' };
    }
    changes.skillLevel = level as SkillLevel;
  }

  if (!draftLat && !draftLng) {
    changes.submissionGps = null;
  } else {
    if (!draftLat || !draftLng) {
      return {
        error: 'Enter both latitude and longitude, or leave both empty to remove the location.',
        field: 'submissionGps',
      };
    }
    const candidate = `${draftLat},${draftLng}`;
    if (!/^-?\d{1,3}(\.\d+)?,-?\d{1,3}(\.\d+)?$/.test(candidate)) {
      return {
        error: 'Enter coordinates as latitude, longitude — for example 5.6037,-0.1870.',
        field: 'submissionGps',
      };
    }
    const latitude = Number(draftLat);
    const longitude = Number(draftLng);
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) {
      return { error: 'Location coordinates are out of range.', field: 'submissionGps' };
    }
    changes.submissionGps = candidate;
  }

  try {
    await apiServer<ProofUpdateResponse>(`/workers/proofs/${proofId}`, {
      method: 'PATCH',
      body: changes,
    });
    redirect(`/logs/${proofId}?updated=1`);
  } catch (error) {
    if (isRedirect(error)) throw error;
    if (error instanceof ApiRequestError) {
      const first = error.issues[0];
      if (first && PROOF_EDIT_FIELD_FOR_PATH[first.path]) {
        return { error: first.message, field: PROOF_EDIT_FIELD_FOR_PATH[first.path] };
      }
      return { error: error.message };
    }
    return { error: 'We could not save those changes. Please try again.' };
  }
}

/**
 * Where the signed-in member's privacy choices are saved.
 *
 * One action for the whole privacy card: discoverability (whether employer
 * search may surface the worker), the name shown on a confirmation link, the
 * public capability page (whether it exists at all — enabling it generates the
 * unguessable address), the invitation preference (who may invite), and whether
 * the worker's connected links may be shown with their profile. Each choice maps
 * onto the one profile PATCH the API accepts — and what it
 * it enforces at the layers that matter, not merely displays.
 *
 * A checkbox submits nothing when it is off and "on" when it is on, so a
 * checkbox alone cannot say whether "off" was chosen or the control was never
 * on the page. The form pairs each one with a hidden "off" submitted first, so
 * the pair always carries the answer and the value read is the checkbox's — the
 * last, present only when it was ticked. A caller that sends neither field still
 * means "leave it alone", which the read below preserves.
 */
export async function savePrivacySetting(_previous: FormState, formData: FormData): Promise<FormState> {
  const discoverable = readCheckbox(formData, 'discoverable');
  const showNameOnVerificationLink = readCheckbox(formData, 'showNameOnVerificationLink');
  const publicProfile = readCheckbox(formData, 'publicProfile');
  const showLinksOnProfile = readCheckbox(formData, 'showLinksOnProfile');
  const invitationPreference = String(formData.get('invitationPreference') ?? '');

  const body: Record<string, unknown> = {};
  if (discoverable !== null) body.discoverable = discoverable;
  if (showNameOnVerificationLink !== null) body.showNameOnVerificationLink = showNameOnVerificationLink;
  if (publicProfile !== null) body.publicProfile = publicProfile;
  if (showLinksOnProfile !== null) body.showLinksOnProfile = showLinksOnProfile;
  if (invitationPreference) {
    if (invitationPreference !== 'all' && invitationPreference !== 'approved_only') {
      return { error: 'Choose who may invite you.' };
    }
    body.invitationPreference = invitationPreference;
  }

  if (Object.keys(body).length === 0) {
    return { error: 'Nothing to change was chosen.' };
  }

  try {
    await apiServer('/auth/profile', { method: 'PATCH', body });
    revalidatePath('/settings/privacy');
    revalidatePath('/profile');
    return { done: true };
  } catch (error) {
    return formErrorFor(error, 'We could not save your privacy choices. Please try again.');
  }
}

/**
 * A checkbox in a form that always carries the control.
 *
 * The form's hidden "off" comes first and the checkbox's "on" only exists while
 * it is ticked, so the last value is the member's real choice. When neither
 * arrived the control is not part of the submitted form, and `null` leaves the
 * stored value untouched.
 */
function readCheckbox(formData: FormData, name: string): boolean | null {
  const values = formData.getAll(name);
  if (values.length === 0) return null;
  return values[values.length - 1] === 'on';
}

/**
 * What a link resend produced, for the component that shows it.
 *
 * The fresh token is returned exactly once, by the same rule as a first
 * submission — see `ProofSubmissionView` for why it is safe to show. The union
 * is discriminated on `done`, so a caller asking for the result after a
 * `done === true` check gets a value and an `error` read is always safe.
 */
export type ResendActionState =
  | { error?: string; done?: false; result?: undefined }
  | {
      done: true;
      result: { verificationUrl: string; verificationExpiresAt: string; verificationLinkSent: boolean };
      error?: undefined;
    };

/**
 * Issues a fresh confirmation link for a log whose earlier link expired or was
 * never handed over.
 *
 * The resend is a write and is never repeated (see `apiServer`), and the API's
 * refusal — a log already verified, or a link still active — comes back with
 * its own wording. The token is only ever returned once, so the result carries
 * it; unlike the main log form there is no redirect-on-success because the link
 * itself is the point of the action, and it has to be shown in place.
 */
export async function resendVerification(
  _previous: ResendActionState,
  formData: FormData,
): Promise<ResendActionState> {
  const proofId = String(formData.get('proofId') ?? '');
  if (!proofId) return { error: 'That log could not be found.' };

  try {
    const resend = await apiServer<VerificationResendResponse>(
      `/workers/proofs/${encodeURIComponent(proofId)}/verification/resend`,
      { method: 'POST', body: {} },
    );
    // Awaited, not stringified in place: `currentOrigin` reads headers, so it
    // answers with a promise, and a promise written into a template becomes
    // `[object Promise]` — a link that looks complete and goes nowhere.
    const origin = (await currentOrigin()) ?? '';
    return {
      done: true,
      result: {
        verificationUrl: `${origin}/verify/${resend.verificationToken}`,
        verificationExpiresAt: resend.verificationExpiresAt,
        verificationLinkSent: resend.verificationLinkSent,
      },
    };
  } catch (error) {
    return { error: messageFor(error, 'We could not prepare a fresh link. Please try again.') };
  }
}

/**
 * Opens one notification: marks it read, then goes where it points.
 *
 * The mark and the navigation are one action because opening a notification *is*
 * the read. Splitting them would need client state to sequence, and any gap
 * between the two is a state where the count says unread while the reader is
 * already looking at the thing it counts.
 *
 * The navigation is a redirect rather than a returned link so that the tap
 * behaves the way a link behaves: a form post answers with a redirect the browser
 * follows, so the reader lands on the log or the offer either way, and the
 * notifications page behind them is already revalidated when they come back.
 *
 * A failure to mark still navigates. The reader asked to see something; refusing
 * to show it because a convenience write failed would be a worse answer than
 * showing it with the count one higher than it should be.
 */
export async function openNotification(formData: FormData): Promise<void> {
  const notificationId = String(formData.get('notificationId') ?? '');
  const link = String(formData.get('link') ?? '');

  // Only same-site paths. The link is stored by the API, but a redirect to
  // somewhere off-origin would turn a tap in the feed into an outbound hop, and
  // `redirect()` accepts an absolute URL without complaint.
  const isInternal = link.startsWith('/') && !link.startsWith('//');
  const destination = isInternal ? link : '/notifications';

  if (notificationId) {
    try {
      await apiServer(`/notifications/${encodeURIComponent(notificationId)}/read`, {
        method: 'POST',
        body: {},
      });
    } catch {
      // As above: the navigation still happens.
    }
  }

  revalidatePath('/notifications');
  redirect(destination);
}

/**
 * Marks every unread notification as read.
 *
 * Kept as an explicit bulk action. It used to double as the side effect of
 * reading the feed; it no longer is, so this is the one way to clear everything
 * at once, and a failure here is a convenience that did not happen rather than an
 * error worth a screen.
 */
export async function markNotificationsRead(): Promise<void> {
  try {
    await apiServer('/notifications/read', { method: 'POST', body: {} });
  } catch {
    // Marking read is a convenience; a failure is not worth an error screen.
  }
  revalidatePath('/notifications');
}

/**
 * Records a reviewer's decision on a record the engine withheld.
 *
 * The two buttons are not opposites. `upheld` is the only route to
 * `fraud_blocked` in the whole system and `overturned` the only route back to
 * `verified`, so the copy on each has to say what it costs and what it returns
 * rather than reading as approve/reject.
 *
 * No free text. The decision is already attributable — the API stores the admin's
 * own id and the time — and a note field on a screen where the wrong click is
 * irreversible would suggest the decision is negotiable afterwards. It is not.
 */
export async function decideProofReview(
  _previous: ReviewState,
  formData: FormData,
): Promise<ReviewState> {
  const proofId = String(formData.get('proofId') ?? '');
  const outcome = String(formData.get('outcome') ?? '');
  if (!proofId || !PROOF_REVIEW_OUTCOMES.includes(outcome as never)) {
    return { error: 'That decision could not be read. Please try again.' };
  }

  try {
    const res = await apiServer<{ proofId: string; verificationStatus: string }>(
      `/admin/proof-review/${encodeURIComponent(proofId)}`,
      { method: 'POST', body: { outcome } },
    );
    revalidatePath('/admin');
    return { done: true, outcome, verificationStatus: res.verificationStatus };
  } catch (error) {
    return {
      error: messageFor(
        error,
        'That decision was not recorded. Nothing has changed — please try again.',
      ),
    };
  }
}

/**
 * Asks for a record the platform withheld to be looked at again.
 *
 * Takes no free text. The reviewer needs the evidence and the recorded signals,
 * both of which are already on the record, and a worker's most likely reason for
 * writing anything here would be a single "please" that adds nothing to either.
 *
 * Returns rather than throws, because the failure is a line under a button on the
 * page the worker is already looking at — the same page an error screen would
 * replace with something less useful.
 */
export async function appealProof(
  _previous: AppealState,
  formData: FormData,
): Promise<AppealState> {
  const proofId = String(formData.get('proofId') ?? '');
  if (!proofId) return { error: 'That log could not be found.' };

  try {
    const res = await apiServer<{ proofId: string; reviewStatus: string }>(
      `/workers/proofs/${encodeURIComponent(proofId)}/appeal`,
      { method: 'POST', body: {} },
    );
    revalidatePath(`/logs/${proofId}`);
    return { done: true, reviewStatus: res.reviewStatus };
  } catch (error) {
    return {
      error: messageFor(error, 'We could not send that request. Please try again in a moment.'),
    };
  }
}

/**
 * Starts the GitHub OAuth dance for the signed-in worker.
 *
 * The start endpoint is authenticated (only members may connect a source to
 * their own account), so it goes through the server rather than the browser's
 * fetch. On success the member is sent to GitHub's authorize page; on any
 * refusal — most commonly "not configured on this deployment" — the message
 * comes back under the button that was pressed.
 */
export async function githubConnect(_previous: FormState, _formData: FormData): Promise<FormState> {
  try {
    const { authorizeUrl } = await apiServer<{ authorizeUrl: string }>(
      '/workers/connections/github/start',
      { method: 'POST', body: {} },
    );
    redirect(authorizeUrl);
  } catch (error) {
    if (isRedirect(error)) throw error;
    return { error: messageFor(error, 'We could not start connecting to GitHub. Please try again.') };
  }
}

/**
 * Disconnects a connected work-capture source.
 *
 * A disconnect is a status flip on a connection that holds no credential (the
 * API never stores the OAuth token), so it is safe and immediate; the card is
 * revalidated so the connected source disappears without a reload.
 */
export async function githubRevoke(_previous: FormState, formData: FormData): Promise<FormState> {
  const provider = String(formData.get('provider') ?? '');
  if (!provider) return { error: 'That connection could not be found.' };

  try {
    await apiServer(`/workers/connections/${encodeURIComponent(provider)}`, { method: 'DELETE' });
    revalidatePath('/profile');
    return { done: true };
  } catch (error) {
    return { error: messageFor(error, 'We could not disconnect that source. Please try again.') };
  }
}

/**
 * True when the thrown value is Next.js's redirect control signal.
 *
 * `redirect` signals by throwing, so a `catch` that swallows everything would turn
 * a successful sign-in into a reported failure and leave the user on the form they
 * just filled in.
 */
function isRedirect(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'digest' in error &&
    typeof (error as { digest?: unknown }).digest === 'string' &&
    (error as { digest: string }).digest.startsWith('NEXT_REDIRECT')
  );
}