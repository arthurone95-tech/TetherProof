'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { passwordProblems } from '@tetherproof/shared';
import type {
  AccountDeletionResult,
  AuthResponse,
  AuthSession,
  ConfirmationChallenge,
  ProofUpdateResponse,
  UpdateProofInput,
  UserRole,
} from '@tetherproof/shared';
import { ApiRequestError } from './api-error';
import type { AuthCallbackResult, FormState, ProofEditState, ProofFormState } from './form-state';
import { formErrorFor } from './form-state';
import { homeFor } from './navigation';
import { apiPublic, apiServer, apiServerForm, currentProfile } from './server/api';
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
function landingFor(role: UserRole): string {
  return homeFor(role);
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
    redirect(landingFor(result.user.role));
  } catch (error) {
    if (isRedirect(error)) throw error;
    return {
      error: messageFor(error, 'We could not sign you in. Please try again.'),
      field: 'password',
    };
  }
}

export async function registerAccount(_previous: FormState, formData: FormData): Promise<FormState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const confirmPassword = String(formData.get('confirmPassword') ?? '');
  const fullName = String(formData.get('fullName') ?? '').trim();
  const role = String(formData.get('role') ?? 'worker');

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
        // Constrained to the same list the API accepts, so the form cannot offer a
        // choice the endpoint will refuse.
        role: role === 'employer' || role === 'training_provider' ? role : 'worker',
        ...(redirectOrigin ? { redirectOrigin } : {}),
      },
    });

    if (result.session) {
      // An account created while the provider auto-confirms arrives signed in.
      await writeSession(result.session);
      redirect(landingFor(result.user.role));
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
    redirect(landingFor(result.user.role));
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

  return { ok: true, landing: landingFor(profile.role) };
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
  const organizationName = String(formData.get('organizationName') ?? '').trim();
  const latitude = String(formData.get('latitude') ?? '').trim();
  const longitude = String(formData.get('longitude') ?? '').trim();

  const body: Record<string, unknown> = {};

  // Sent only when the form actually has the input. The employer's details card
  // does not ask for a person's name, and a missing field has to mean "leave it
  // alone" rather than "clear it" — the API refuses an empty name instead of
  // accepting one, so a form that never sent it would be refused for a value it
  // never chose.
  if (formData.has('fullName')) {
    const fullName = String(formData.get('fullName') ?? '').trim();
    if (!fullName) return { error: 'Enter your name.', field: 'fullName' };
    body.fullName = fullName;
  }

  if (formData.has('organizationName') && organizationName) {
    body.organizationName = organizationName;
  }

  // An empty pair means "no location", which is a real choice: searches then run
  // without a distance filter instead of from a stale point. One coordinate alone
  // is not a location and is refused rather than silently filled in from the other.
  let locationGps: string | null;
  if (latitude === '' && longitude === '') {
    locationGps = null;
  } else if (latitude === '' || longitude === '') {
    return { error: 'Enter both a latitude and a longitude, or clear both.' };
  } else {
    const parsed = parseCoordinatePair(latitude, longitude);
    if (!parsed) return { error: 'That is not a valid location. Use decimal degrees.' };
    locationGps = parsed;
  }
  body.locationGps = locationGps;

  try {
    await apiServer('/auth/profile', { method: 'PATCH', body });
    revalidatePath('/profile');
    revalidatePath('/employer');
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
    revalidatePath('/employer');
    return { done: true };
  } catch (error) {
    return { error: messageFor(error, 'We could not save that search. Please try again.') };
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
    } else {
      await apiServer(path, { method: 'PATCH', body: { isActive: intent === 'activate' } });
    }
  } catch (error) {
    // These controls have no field to attach a message to, so the reason is
    // re-thrown as a redirect the page can render.
    redirect(`/employer?error=${encodeURIComponent(messageFor(error, 'That change did not apply.'))}`);
  }

  revalidatePath('/employer');
}

export async function sendOffer(_previous: FormState, formData: FormData): Promise<FormState> {
  const candidateHandle = String(formData.get('candidateHandle') ?? '');
  const note = String(formData.get('note') ?? '').trim();

  try {
    await apiServer('/employers/offers', {
      method: 'POST',
      body: note ? { candidateHandle, note } : { candidateHandle },
    });
    revalidatePath('/employer');
    return { done: true };
  } catch (error) {
    return { error: messageFor(error, 'We could not send that invitation. Please try again.') };
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
  verifierPhone: 'verifierPhone',
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

  const verifierPhone = String(formData.get('verifierPhone') ?? '').trim();
  if (verifierPhone && !/^\+?[0-9]{7,15}$/.test(verifierPhone)) {
    return {
      error: 'Enter a phone number with country code, such as +233241234567.',
      field: 'verifierPhone',
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

  for (const key of ['submissionGps', 'verifierPhone']) {
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