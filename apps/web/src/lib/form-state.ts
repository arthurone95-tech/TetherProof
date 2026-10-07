import type { ApiFieldIssue } from './api-error';
import { ApiRequestError } from './api-error';

/**
 * Result of a form submission.
 *
 * Errors are returned rather than thrown because a thrown error in a server action
 * renders Next.js's own error screen and discards what the user typed. `field` lets a
 * form point at the input at fault, so a message lands next to the field instead of at
 * the top of a long form.
 *
 * This lives outside `lib/actions.ts` because a `'use server'` module may only export
 * async functions, and the initial state is a plain object.
 */
export interface FormState {
  error?: string;
  field?: 'email' | 'password' | 'confirmPassword' | 'fullName' | 'organizationName' | 'code' | 'requiredSkill';
  /**
   * True once an action has completed successfully.
   *
   * Success is an explicit flag rather than the absence of an error, because a form
   * that has not been submitted yet also has no error and would otherwise report
   * itself as already saved.
   */
  done?: boolean;
  /** Masked destination a sign-in code was sent to, when one was just requested. */
  sentTo?: string;
}

/** The state of a form that has not been submitted yet. */
export const EMPTY_FORM: FormState = {};

/**
 * Result of logging a completed job.
 *
 * Its own type rather than an extra field on `FormState`, because the proof form
 * is the only one with something to show on success: a confirmation link that is
 * returned exactly once and cannot be fetched again. Keeping it here rather than
 * in `lib/actions.ts` follows the same rule as `FormState` — a `'use server'`
 * module may only export async functions, and this is a type.
 */
export interface ProofFormState {
  error?: string;
  /**
   * The input the refusal belongs to, when the API or the action named one.
   *
   * `media_file` is the file input rather than a text box, so a form knows to put
   * the message inside the evidence panel instead of at the top where it would be
   * read as a problem with the whole submission.
   */
  field?: 'skillTag' | 'description' | 'submissionGps' | 'verifierPhone' | 'media_file';
  done?: boolean;
  /** Present only after a submission was accepted. */
  result?: ProofSubmissionView;
}

/**
 * What the worker needs to keep from a submission.
 *
 * The token is here because the API returns it once and stores only its digest:
 * nothing can recover it later, so this state is the only place it ever exists.
 */
export interface ProofSubmissionView {
  proofId: string;
  skillTag: string;
  /** The page the verifier opens, already assembled for sharing. */
  verificationUrl: string;
  /** False means no number was given or dispatch failed — share the link yourself. */
  verificationLinkSent: boolean;
  verificationExpiresAt: string;
  /** What the scrubber stripped before anything was written to storage. */
  scrubbed: { hadGps: boolean; hadMetadata: boolean; hadAudioTags: boolean };
}

/** The state of a proof form that has not been submitted yet. */
export const EMPTY_PROOF: ProofFormState = {};

/**
 * Result of editing an existing log entry.
 *
 * A separate, smaller state from `ProofFormState`: editing sends no media and
 * succeeds by re-rendering the entry, so it only needs to name which field was
 * refused and why.
 */
export interface ProofEditState {
  error?: string;
  field?: 'description' | 'skillTag' | 'submissionGps';
}

/** The state of an edit form that has not been submitted yet. */
export const EMPTY_PROOF_EDIT: ProofEditState = {};

/**
 * Outcome of handing a confirmation link's session to the application.
 *
 * Returned rather than redirected on, because the page that reads it also has to
 * explain a failure, and `redirect()` in a server action has no way to come back
 * and do that. `landing` is where the caller should navigate on success; the
 * caller performs the navigation so the address bar is rewritten in one step and
 * the credentials the link carried are gone from it.
 */
export type AuthCallbackResult =
  | { ok: true; landing: string }
  | { ok: false; error: string };

/**
 * Which input an API-reported path belongs to.
 *
 * Only paths that have a named input in one of the forms are listed. A path that is
 * not here — `phoneNumber` on a form that only asks for an email, or `role` on a
 * form whose select can only hold an accepted value — deliberately falls through to
 * a form-level message, because pointing at a field that did not cause the failure
 * sends the reader to fix the wrong thing.
 */
const FIELD_FOR_PATH: Partial<Record<string, NonNullable<FormState['field']>>> = {
  email: 'email',
  password: 'password',
  fullName: 'fullName',
  organizationName: 'organizationName',
  code: 'code',
  requiredSkill: 'requiredSkill',
};

/**
 * Turns an API failure into something a form can render beside the right input.
 *
 * The API answers a validation refusal twice: a request-level message that is safe
 * to show and says nothing about the mistake, and field-level `issues` that say
 * exactly what was wrong. This prefers the second and falls back to the first, so a
 * password that is too short reads `Password must be at least 12 characters.` under
 * the password box rather than `Request body failed validation.` at the top of the
 * form — which is what a person was shown, and could do nothing with.
 *
 * `fallback` is used for failures the API did not annotate: a network error, a 500,
 * or anything unexpected. It never forwards an error's own text, because that may
 * describe the database or the provider rather than something the user can act on.
 */
export function formErrorFor(error: unknown, fallback: string): FormState {
  if (error instanceof ApiRequestError) {
    const first: ApiFieldIssue | undefined = error.issues[0];
    const field = first ? FIELD_FOR_PATH[first.path] : undefined;
    if (first && field) return { error: first.message, field };
    if (first) return { error: first.message };
    return { error: error.message };
  }
  return { error: fallback };
}
