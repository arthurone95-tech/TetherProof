'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import type {
  AccountDeletionResult,
  AuthResponse,
  ConfirmationChallenge,
  UserRole,
} from '@tetherproof/shared';
import { ApiRequestError } from './api-error';
import type { FormState } from './form-state';
import { apiPublic, apiServer } from './server/api';
import { clearSession, writeSession } from './server/session';

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
 * Employers and workers each have a home. The training provider and admin roles have
 * no interface yet, and sending them to a page that pretends otherwise would be
 * worse than saying so.
 */
function landingFor(role: UserRole): string {
  switch (role) {
    case 'employer':
      return '/employer';
    case 'worker':
      return '/invites';
    default:
      return '/pending';
  }
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
  const fullName = String(formData.get('fullName') ?? '').trim();
  const role = String(formData.get('role') ?? 'worker');

  if (!email) return { error: 'Enter your email address.', field: 'email' };
  if (fullName.length === 0) return { error: 'Enter your name.', field: 'fullName' };

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
    return { error: messageFor(error, 'We could not create that account. Please try again.') };
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

  try {
    const challenge = await apiPublic<ConfirmationChallenge>('/auth/confirm/request', {
      method: 'POST',
      body: { email },
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
 * Saves the organization name and the location distances are measured from.
 *
 * Both live on the same profile row and are set together because the employer sees
 * them in the same place: the name a worker reads on an invitation, and the origin
 * their searches measure from.
 */
export async function saveProfile(_previous: FormState, formData: FormData): Promise<FormState> {
  const organizationName = String(formData.get('organizationName') ?? '').trim();
  const latitude = String(formData.get('latitude') ?? '').trim();
  const longitude = String(formData.get('longitude') ?? '').trim();

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

  const body: Record<string, unknown> = { locationGps };
  if (organizationName) body.organizationName = organizationName;

  try {
    await apiServer('/auth/profile', { method: 'PATCH', body });
    revalidatePath('/employer');
    return { done: true };
  } catch (error) {
    return {
      error: messageFor(error, 'We could not save that. Please try again.'),
      field: organizationName ? 'organizationName' : undefined,
    };
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