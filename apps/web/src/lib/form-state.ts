import type { ApiFieldIssue } from './api-error';
import { ApiRequestError } from './api-error';

/**
 * Result of asking for a withheld record to be reviewed.
 *
 * A union discriminated on `done`, because "we asked" and "we could not ask"
 * are different outcomes and the button has to say which happened rather than
 * resetting either way.
 *
 * Lives outside `lib/actions.ts` because a `'use server'` module may only
 * export async functions, and this is a plain object and a type.
 */
export type AppealState =
  | { done?: false; error?: string; reviewStatus?: string }
  | { done: true; error?: undefined; reviewStatus: string };

export const EMPTY_APPEAL: AppealState = {};

/**
 * Result of a reviewer's decision on a withheld record.
 *
 * Separate from `FormState` rather than reusing it, because the two failures
 * read very differently and the reviewer has to be able to tell them apart. A
 * lost race ("someone else decided a moment ago") is not an error — the
 * system worked.
 */
export type ReviewState =
  | { done?: false; error?: string; outcome?: string }
  | { done: true; error?: undefined; outcome: string; verificationStatus: string };

export const EMPTY_REVIEW: ReviewState = {};

/**
 * Result of a form submission.
 *
 * Errors are returned rather than thrown because a thrown error in a server
 * action renders Next.js's own error screen and discards what the user typed.
 * `field` lets a form point at the input at fault, so a message lands next to
 * the field instead of at the top of a long form.
 */
export interface FormState {
  error?: string;
  field?:
    | 'email'
    | 'password'
    | 'confirmPassword'
    | 'fullName'
    | 'organizationName'
    | 'code'
    | 'requiredSkill'
    | 'avatar_file'
    /** The location pair on a profile form; the message attaches to the latitude box. */
    | 'latitude';
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
  field?: 'skillTag' | 'description' | 'submissionGps' | 'media_file';
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
  /**
   * Whether a messaging provider accepted the link. Always false now that the form
   * does not collect a number; kept so the provider integration stays wired and a
   * future automatic-dispatch flow has somewhere to report to.
   */
  verificationLinkSent: boolean;
  verificationExpiresAt: string;
  /** What the scrubber stripped before anything was written to storage. */
  scrubbed: { hadGps: boolean; hadMetadata: boolean; hadAudioTags: boolean };
}

/** The state of a proof form that has not been submitted yet. */
export const EMPTY_PROOF: ProofFormState = {};

/**
 * Result of signing off on a milestone, and of answering one.
 *
 * Its own type because the milestone issuer needs something `FormState` has no room
 * for: the credential that was created, so the page can name the practical the
 * institute just recorded rather than only reporting that something happened.
 *
 * `awaitingStudent` is carried because the outcome genuinely is not "done". A
 * credential the student has not answered is a notification, not a credential, and
 * a form that said "Saved!" would be telling the instructor something untrue.
 */
export interface MilestoneState {
  error?: string;
  field?: 'enrolmentId' | 'skillTag' | 'milestoneTitle' | 'note' | 'code';
  done?: boolean;
  /** The recorded practical, present only once one has been created. */
  issued?: {
    id: string;
    studentName: string | null;
    skillTag: string;
    milestoneTitle: string;
  };
  /**
   * A freshly generated enrolment code, returned exactly once and never readable
   * again. Carried in state so the roster page can show it to copy immediately
   * after generating, which is the only moment it exists.
   */
  enrolmentCode?: string;
  /** True once a student has answered, for the accept/decline buttons. */
  answered?: 'accepted' | 'declined';
  /** The institute a student just joined, named on a successful redemption. */
  enrolledWith?: string | null;
}

export const EMPTY_MILESTONE: MilestoneState = {};

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
